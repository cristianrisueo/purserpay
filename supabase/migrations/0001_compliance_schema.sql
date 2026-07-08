-- ============================================================================
-- PurserPay — 0001_compliance_schema
-- GDPR / OFAC "Data Dissociation" schema.
--
-- Two tiers of compliance data, and nothing readable is stored:
--   * Account-holder PII  -> encrypted at rest with pgcrypto (AES via
--     pgp_sym_encrypt); the key lives in the Next.js server, never in the DB.
--   * Sanctioned wallets  -> stored ONLY as salted SHA-256 hashes (no plaintext
--     addresses ever land in the database).
--
-- Idempotent and safe to run in the Supabase SQL editor or via `supabase db push`.
-- After running, reload the PostgREST schema cache (Supabase does this on save, or
-- run:  notify pgrst, 'reload schema';) so the RPC below is callable over the API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) pgcrypto — provides pgp_sym_encrypt/pgp_sym_decrypt (AES).
--    On Supabase, extensions install into the `extensions` schema. If pgcrypto is
--    already present elsewhere (e.g. public) this is a no-op; the RPC below pins a
--    search_path that resolves pgp_sym_encrypt wherever it lives.
--    gen_random_uuid() is core Postgres (>= 13), always available in pg_catalog.
-- ----------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 2) Account-holder PII, encrypted at rest.
--    wallet_hash is the dissociated key (salted SHA-256, a plaintext hash — it is
--    already pseudonymous, so it is not itself encrypted). encrypted_pii is the
--    pgp_sym_encrypt ciphertext blob. Identity is thereby separated from payout
--    activity by design.
-- ----------------------------------------------------------------------------
create table if not exists public.billing_profiles (
    id            uuid        primary key default gen_random_uuid(),
    wallet_hash   text        not null unique,   -- UNIQUE also provides the index
    encrypted_pii bytea       not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3) OFAC / sanctions list — salted-hash only, never plaintext addresses.
-- ----------------------------------------------------------------------------
create table if not exists public.ofac_sanctions (
    wallet_hash text        primary key,
    created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) Zero-trust lockdown. Enable RLS with NO policies -> anon and authenticated
--    are denied by default. Only service_role (used exclusively by the Next.js
--    Server Actions) bypasses RLS, so the browser can never read the sanctions
--    list or any PII, encrypted or otherwise.
-- ----------------------------------------------------------------------------
alter table public.billing_profiles enable row level security;
alter table public.ofac_sanctions   enable row level security;

-- ----------------------------------------------------------------------------
-- 5) Encrypt + upsert PII. Fully parameterized (no string concatenation). The AES
--    key is supplied by the server on each call and is NEVER persisted. security
--    invoker + a pinned search_path (so pgp_sym_encrypt resolves from public or
--    extensions, and an untrusted search_path can't shadow it).
-- ----------------------------------------------------------------------------
create or replace function public.encrypt_and_store_pii(
    p_wallet_hash text,
    p_pii         text,
    p_key         text
)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
    insert into public.billing_profiles (wallet_hash, encrypted_pii)
    values (p_wallet_hash, pgp_sym_encrypt(p_pii, p_key))
    on conflict (wallet_hash) do update
        set encrypted_pii = pgp_sym_encrypt(p_pii, p_key),
            updated_at    = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Restrict the RPC to service_role only (defense-in-depth on top of RLS).
--    Revoking from PUBLIC also covers the anon and authenticated roles.
-- ----------------------------------------------------------------------------
revoke all     on function public.encrypt_and_store_pii(text, text, text) from public;
grant  execute on function public.encrypt_and_store_pii(text, text, text) to service_role;
