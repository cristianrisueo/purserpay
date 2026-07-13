-- ============================================================================
-- PurserPay — 0002_free_tier_usage
-- The Free Tier quota table + its atomic-consume / refund / purge functions.
--
-- The Free Tier: ONE (1) payee per payer wallet, once every 30 days, forever.
-- It is an OFF-CHAIN software-licence gate (disperse() is permissionless and
-- immutable — the free tier is NOT and CANNOT be enforced on-chain). See
-- docs/07-freemium-gate.md.
--
-- DATA MINIMIZATION / DISSOCIATION — read before touching this:
--   * This table holds NO PII and is NOT linked to the account holder. It stores
--     only a SALTED SHA-256 hash of the PAYER wallet (same WALLET_SALT pepper and
--     trim-only normalization as the OFAC screening — src/lib/crypto.ts) plus a
--     single timestamp. The raw address never lands here.
--   * The quota is anchored on the PAYER wallet ONLY — never on recipients.
--     Anchoring on recipients would require a global registry of other people's
--     payee wallets, a GDPR liability we deliberately refuse.
--   * Because it carries no PII and is not tied to an identity, it is OUT OF SCOPE
--     for the Art. 17 (right-to-erasure) path (which wipes billing_profiles). The
--     60-day TTL purge below is the whole of its retention story.
--
-- ZERO CLIENT ACCESS — RLS is on with NO policies; only the service_role (used by
-- the Next.js route handlers) bypasses RLS. The browser can never read or write it.
--
-- Idempotent and safe to run in the Supabase SQL editor or via `supabase db push`.
-- Mirrors the style of 0001_compliance_schema.sql. After running, reload the
-- PostgREST schema cache (Supabase does this on save, or run:
--   notify pgrst, 'reload schema';) so the RPCs below are callable over the API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) The quota table. payer_wallet_hash is a salted SHA-256 hash (already
--    pseudonymous, so not itself encrypted). One row per payer wallet; the PK
--    doubles as the uniqueness + lookup index. last_free_payout_at is the only
--    fact the 30-day gate needs.
-- ----------------------------------------------------------------------------
create table if not exists public.free_tier_usage (
    payer_wallet_hash   text        primary key,   -- salted SHA-256 (WALLET_SALT)
    last_free_payout_at timestamptz not null,
    created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2) Zero-trust lockdown. Enable RLS with NO policies -> anon and authenticated
--    are denied by default. Only service_role (the route handlers) bypasses RLS.
-- ----------------------------------------------------------------------------
alter table public.free_tier_usage enable row level security;

-- ----------------------------------------------------------------------------
-- 3) ATOMIC CONSUME — the whole TOCTOU defense.
--    A single INSERT ... ON CONFLICT ... WHERE ... RETURNING. Postgres row-locks
--    the conflict target, so N concurrent callers for the same wallet resolve to
--    EXACTLY ONE row returned. NEVER split this into a SELECT-then-INSERT.
--
--    The route calls this OPTIMISTICALLY, BEFORE the client broadcasts, so a
--    ~3s TRON block window can't let parallel batches all pass the check.
--
--    Returns (consumed, at):
--      * success -> (true,  now())               -- the slot was just consumed
--      * blocked -> (false, <existing last_free_payout_at>)
--                                                -- so the route can compute
--                                                --   nextAvailableAt = at + 30 days
--      * blocked with no row is impossible: a conflict means a row exists.
--    security invoker + pinned search_path (defense in depth, matches 0001).
-- ----------------------------------------------------------------------------
create or replace function public.consume_free_tier(p_wallet_hash text)
returns table (consumed boolean, at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_at timestamptz;
begin
    insert into public.free_tier_usage (payer_wallet_hash, last_free_payout_at)
    values (p_wallet_hash, now())
    on conflict (payer_wallet_hash) do update
        set last_free_payout_at = now()
        where free_tier_usage.last_free_payout_at <= now() - interval '30 days'
    returning free_tier_usage.last_free_payout_at into v_at;

    if v_at is not null then
        -- Consumed just now.
        return query select true, v_at;
    else
        -- Blocked (still within the 30-day cooldown). Report when it unlocks.
        return query
            select false, f.last_free_payout_at
            from public.free_tier_usage f
            where f.payer_wallet_hash = p_wallet_hash;
    end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) REFUND / RELEASE — restore a slot the payout never actually used.
--    Called by /api/payout/release AFTER server-side on-chain verification that
--    the disperse genuinely did NOT happen (wallet rejected, tx reverted, tx
--    never landed). GUARDED by p_consumed_at: we only undo the exact consume we
--    made, so a newer consume (a later month) is never wiped. Deleting our
--    consume returns the wallet to prior eligibility — equivalent to restoring
--    the previous value, since any prior value was necessarily >= 30 days old.
-- ----------------------------------------------------------------------------
create or replace function public.release_free_tier(
    p_wallet_hash  text,
    p_consumed_at  timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    delete from public.free_tier_usage
    where payer_wallet_hash = p_wallet_hash
      and last_free_payout_at = p_consumed_at;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) TTL PURGE — data minimization. The gate only needs 30 days of history; keep
--    a 60-day margin then delete. Idempotent; safe to run any time.
-- ----------------------------------------------------------------------------
create or replace function public.purge_free_tier_usage()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    delete from public.free_tier_usage
    where last_free_payout_at < now() - interval '60 days';
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Grants. BYPASSRLS (service_role) skips POLICIES but not table-level GRANTs;
--    without these the route handlers get 42501. The functions are SECURITY
--    INVOKER, so they run as the caller (service_role) and need table DML.
--    RPC execute revoked from PUBLIC (covers anon + authenticated), granted to
--    service_role only.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.free_tier_usage to service_role;

revoke all     on function public.consume_free_tier(text)                 from public;
revoke all     on function public.release_free_tier(text, timestamptz)    from public;
revoke all     on function public.purge_free_tier_usage()                 from public;
grant  execute on function public.consume_free_tier(text)                 to service_role;
grant  execute on function public.release_free_tier(text, timestamptz)    to service_role;
grant  execute on function public.purge_free_tier_usage()                 to service_role;

-- ----------------------------------------------------------------------------
-- 7) Schedule the purge. Preferred: pg_cron (keeps retention in the DB layer, no
--    external trigger). Guarded so this migration still succeeds on a project
--    where pg_cron isn't available/permitted — in that case wire the FALLBACK
--    below. Runs daily at 03:17 UTC.
--
--    FALLBACK (if pg_cron is absent): add a Vercel Cron in vercel.json /
--    vercel.ts hitting a tiny protected route that calls
--    supabase.rpc('purge_free_tier_usage'), e.g.:
--        { "crons": [{ "path": "/api/payout/purge", "schedule": "17 3 * * *" }] }
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
            perform cron.unschedule('purge_free_tier_usage');
        exception when others then
            null; -- no existing job
        end;
        perform cron.schedule(
            'purge_free_tier_usage',
            '17 3 * * *',
            $cron$ select public.purge_free_tier_usage(); $cron$
        );
    end if;
end;
$$;

-- Reload the PostgREST schema cache so the new RPCs/grants resolve over the API.
notify pgrst, 'reload schema';
