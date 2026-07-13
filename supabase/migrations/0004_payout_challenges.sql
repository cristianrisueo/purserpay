-- ============================================================================
-- PurserPay — 0004_payout_challenges
-- The wallet-control challenge table + its issue / atomic-consume / purge functions.
--
-- WHY: /api/payout/authorize acts on a client-supplied payer address. Wallet
-- addresses are PUBLIC on-chain, so without proof of control anyone could POST a
-- paying customer's address and consume that customer's free-tier slot or burn a
-- banked referral credit month. The fix is a wallet-signature challenge (NOT an auth
-- system): the server mints a single-use nonce, the client signs a human-readable
-- message with its own wallet (TIP-191 / signMessageV2), and the authorize route
-- recovers the signer and asserts it equals the payer BEFORE touching any quota or
-- credit. See docs/07-freemium-gate.md ("Proving wallet control").
--
-- DATA MINIMIZATION / DISSOCIATION — read before touching this:
--   * This table holds NO PII. It stores only a SALTED SHA-256 hash of the wallet
--     (same WALLET_SALT pepper + trim-only normalization as OFAC / free-tier /
--     referral — src/lib/crypto.ts) plus an ephemeral nonce and a short expiry. The
--     raw address never lands here.
--   * Rows are ephemeral (5-minute TTL for use; a 1-day purge margin). Out of scope
--     for Art. 17 erasure (no PII, not tied to an identity) — governed by the purge.
--
-- ZERO CLIENT ACCESS — RLS is on with NO policies; only the service_role (used by
-- the Next.js route handlers) bypasses RLS. The browser can never read or write it.
--
-- Idempotent and safe to run in the Supabase SQL editor or via `supabase db push`.
-- Mirrors the style of 0002_free_tier_usage.sql. After running, reload the PostgREST
-- schema cache (Supabase does this on save, or run:
--   notify pgrst, 'reload schema';) so the RPCs below are callable over the API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) The challenge table. nonce is a CSPRNG hex string (the PK doubles as the
--    lookup index). wallet_hash binds the challenge to the address it was issued
--    for (salted SHA-256, already pseudonymous, so not itself encrypted).
--    expires_at is the authoritative 5-minute window; used_at is null until the
--    single-use consume flips it.
-- ----------------------------------------------------------------------------
create table if not exists public.payout_challenges (
    nonce       text        primary key,   -- CSPRNG hex (32 bytes -> 64 hex)
    wallet_hash text        not null,       -- salted SHA-256 (WALLET_SALT), NEVER the raw addr
    expires_at  timestamptz not null,
    used_at     timestamptz,                -- null until consumed (single-use)
    created_at  timestamptz not null default now()
);

-- Purge helper needs to scan by expiry.
create index if not exists payout_challenges_expires_at_idx
    on public.payout_challenges (expires_at);

-- ----------------------------------------------------------------------------
-- 2) Zero-trust lockdown. Enable RLS with NO policies -> anon and authenticated
--    are denied by default. Only service_role (the route handlers) bypasses RLS.
-- ----------------------------------------------------------------------------
alter table public.payout_challenges enable row level security;

-- ----------------------------------------------------------------------------
-- 3) ISSUE — mint a fresh challenge. A plain insert; the nonce PK guarantees
--    uniqueness (a CSPRNG 32-byte collision is infeasible). security invoker +
--    pinned search_path (defense in depth, matches 0002).
-- ----------------------------------------------------------------------------
create or replace function public.issue_payout_challenge(
    p_nonce       text,
    p_wallet_hash text,
    p_expires_at  timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    insert into public.payout_challenges (nonce, wallet_hash, expires_at)
    values (p_nonce, p_wallet_hash, p_expires_at);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) ATOMIC SINGLE-USE CONSUME — the replay + TOCTOU defense.
--    A single guarded UPDATE ... RETURNING. Postgres row-locks the matched row,
--    so N concurrent callers for the same nonce resolve to EXACTLY ONE row
--    returned (the others see used_at already set and match nothing). NEVER split
--    this into a SELECT-then-UPDATE.
--
--    Matches only an UNUSED, UNEXPIRED challenge bound to this wallet_hash, so a
--    used / expired / unknown nonce, or one issued for a different address, all
--    return zero rows -> the caller returns 403 and consumes nothing downstream.
--
--    Returns the challenge's expires_at so the caller can reconstruct the exact
--    signed message (its "Expires:" line) for signature recovery.
--    security invoker + pinned search_path.
-- ----------------------------------------------------------------------------
create or replace function public.consume_payout_challenge(
    p_nonce       text,
    p_wallet_hash text
)
returns table (expires_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    update public.payout_challenges c
       set used_at = now()
     where c.nonce = p_nonce
       and c.wallet_hash = p_wallet_hash
       and c.used_at is null
       and c.expires_at > now()
    returning c.expires_at;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) TTL PURGE — data minimization. Challenges are ephemeral (5-minute use
--    window); keep a 1-day margin then delete. Idempotent; safe to run any time.
-- ----------------------------------------------------------------------------
create or replace function public.purge_payout_challenges()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    delete from public.payout_challenges
    where expires_at < now() - interval '1 day';
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Grants. BYPASSRLS (service_role) skips POLICIES but not table-level GRANTs;
--    without these the route handlers get 42501. The functions are SECURITY
--    INVOKER, so they run as the caller (service_role) and need table DML.
--    RPC execute revoked from PUBLIC (covers anon + authenticated), granted to
--    service_role only.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.payout_challenges to service_role;

revoke all     on function public.issue_payout_challenge(text, text, timestamptz) from public;
revoke all     on function public.consume_payout_challenge(text, text)            from public;
revoke all     on function public.purge_payout_challenges()                       from public;
grant  execute on function public.issue_payout_challenge(text, text, timestamptz) to service_role;
grant  execute on function public.consume_payout_challenge(text, text)            to service_role;
grant  execute on function public.purge_payout_challenges()                       to service_role;

-- ----------------------------------------------------------------------------
-- 7) Schedule the purge. Preferred: pg_cron (keeps retention in the DB layer, no
--    external trigger). Guarded so this migration still succeeds on a project
--    where pg_cron isn't available/permitted — in that case wire the FALLBACK
--    below. Runs daily at 03:23 UTC.
--
--    FALLBACK (if pg_cron is absent): add a Vercel Cron in vercel.json / vercel.ts
--    hitting a tiny protected route that calls
--    supabase.rpc('purge_payout_challenges'), e.g.:
--        { "crons": [{ "path": "/api/payout/purge", "schedule": "23 3 * * *" }] }
--    The route reads a CRON_SECRET header and calls the RPC via the service role.
-- ----------------------------------------------------------------------------
do $$
begin
    -- Try to provision pg_cron; ignore if the role can't create it here.
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron not available (%). Use the Vercel-cron fallback for the purge.', sqlerrm;
    end;

    -- Schedule only if the cron schema materialized.
    if exists (select 1 from pg_namespace where nspname = 'cron') then
        -- Unschedule a prior copy (safe if none exists), then (re)schedule.
        begin
            perform cron.unschedule('purge_payout_challenges');
        exception when others then
            null; -- no existing job
        end;
        perform cron.schedule(
            'purge_payout_challenges',
            '23 3 * * *',
            $cron$ select public.purge_payout_challenges(); $cron$
        );
    end if;
end;
$$;

-- Reload the PostgREST schema cache so the new RPCs/grants resolve over the API.
notify pgrst, 'reload schema';
