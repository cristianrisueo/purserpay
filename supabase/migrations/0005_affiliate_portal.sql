-- ============================================================================
-- PurserPay — 0005_affiliate_portal
-- The payee-facing affiliate portal: a dissociated, forward-only index of
-- disperse payouts (so a payee can prove they were paid THROUGH PurserPay) plus a
-- grant-only bounty ledger for the manual referral payout.
--
-- WHY THIS EXISTS (and the doctrine it touches):
--   PurserPay keeps NO server record of who was paid — the roster is device-local
--   (Dexie) and the on-chain Dispersed(payer, token, count, total) event carries NO
--   per-recipient data. So a payee's own receipt history cannot be read from the
--   chain; it needs a server-side index, populated GOING FORWARD.
--
--   This is a real modification of the "roster never leaves the device" invariant —
--   handled explicitly, not papered over. The ROSTER (names + wallets the agency
--   types) STILL never leaves the device. disperse_receipts is a DIFFERENT thing:
--     * dissociated — recipient wallets are SALTED SHA-256 hashes (same WALLET_SALT
--       pepper + trim-only normalization as OFAC / free-tier / referral —
--       src/lib/crypto.ts). No names, no cleartext recipient wallets, no PII.
--     * on-chain-derived — every stored field comes from a VERIFIED disperse tx's
--       public calldata (src/lib/tron/serverRead.ts → verifyDisperseTx), never a
--       client claim. The payer wallet is stored in the clear because it is PUBLIC
--       on-chain and the payee needs to see which agency paid them.
--     * forward-only — written at pay time; NO backfill, NO generic chain scan
--       (which is exactly what B5 forbids). Early affiliates see history build up as
--       their agencies pay.
--   See docs/09-affiliate-portal.md.
--
-- THE BOUNTY LEDGER IS GRANT-ONLY. affiliate_bounties is auditable accounting for a
-- MANUAL bounty the owner settles by hand (50 USDT/mo × 6 per referred agency). It
-- can only ever GRANT — it is NEVER read on the receipts path and can never gate or
-- deny an affiliate's access to their own receipts. The displayed figure is a DEBT
-- ACCUMULATOR in Supabase (owner pays out manually, then resets), NOT a wallet
-- balance and NOT an on-chain amount. The accrual ENGINE (auto-incrementing months)
-- is deliberately out of scope here.
--
-- DATA DISSOCIATION — read before touching this: every wallet is keyed by the SAME
-- salted SHA-256 hash the rest of the schema uses. Do NOT introduce a second hashing
-- scheme.
--
-- ZERO CLIENT ACCESS — RLS on with NO policies; only service_role (the Next.js route
-- handlers) bypasses RLS. The browser can never read or write these tables.
--
-- Idempotent and safe to re-run. Mirrors the style of 0002/0003/0004. After running,
-- reload the PostgREST schema cache (Supabase does this on save, or run:
--   notify pgrst, 'reload schema';) so the RPCs below are callable over the API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Mark which referral_accounts rows are AFFILIATES (payees who signed into the
--    portal), as opposed to agencies (subscribers). The opaque code is REUSED from
--    referral_accounts (0003) — an affiliate IS a referral account whose reward is a
--    manual bounty, not a free month. The flag lets the claim path pay a bounty ONLY
--    for affiliate-owned codes, so an agency→agency referral (which already earns a
--    free month via 0003) never ALSO double-pays a bounty.
-- ----------------------------------------------------------------------------
alter table public.referral_accounts
    add column if not exists is_affiliate boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2) The disperse-anchored receipt index. One row per (recipient, disperse tx).
--    recipient_wallet_hash is the ONLY recipient identifier stored (salted SHA-256).
--    payer_wallet is the agency (public on-chain). batch_id == txid (one disperse
--    tx == one batch). block_ts may be null (fallback to recorded_at at read time).
--    UNIQUE (txid, recipient_wallet_hash) makes recording idempotent — a re-POST of
--    the same tx never duplicates.
-- ----------------------------------------------------------------------------
create table if not exists public.disperse_receipts (
    id                    bigint      generated always as identity primary key,
    recipient_wallet_hash text        not null,   -- salted SHA-256 (WALLET_SALT), NEVER the raw addr
    payer_wallet          text        not null,   -- the paying agency (PUBLIC on-chain, base58)
    amount_base_units     text        not null,   -- stringified uint, USDT 6dp
    txid                  text        not null,   -- the disperse batch tx (public)
    batch_id              text        not null,   -- == txid (one disperse tx = one batch)
    network               text        not null,   -- nile | mainnet (receipts never cross networks)
    block_ts              timestamptz,            -- from the tx info; null -> read falls back to recorded_at
    recorded_at           timestamptz not null default now(),
    unique (txid, recipient_wallet_hash)
);

-- The one hot read path: a payee's own receipts by their salted hash.
create index if not exists disperse_receipts_recipient_idx
    on public.disperse_receipts (recipient_wallet_hash);

-- ----------------------------------------------------------------------------
-- 3) The bounty ledger. One row per (affiliate, referred agency). accrued_amount is
--    the pending debt the owner settles manually (default 50 = month 1 owed on
--    qualification); months_paid tracks how many of the 6 bounty months have been
--    PAID OUT by hand. status lets the owner close a ledger row. GRANT-ONLY: nothing
--    on the receipts path ever reads this table.
-- ----------------------------------------------------------------------------
create table if not exists public.affiliate_bounties (
    id                          bigint      generated always as identity primary key,
    referral_code               text        not null,   -- the affiliate's opaque code (public share code)
    affiliate_wallet_hash       text        not null,   -- salted SHA-256 (WALLET_SALT)
    referred_agency_wallet_hash text        not null,   -- salted SHA-256 (WALLET_SALT)
    activated_at                timestamptz not null default now(),
    months_paid                 integer     not null default 0 check (months_paid between 0 and 6),
    accrued_amount              numeric     not null default 50 check (accrued_amount >= 0),
    status                      text        not null default 'active',
    created_at                  timestamptz not null default now(),
    unique (affiliate_wallet_hash, referred_agency_wallet_hash)  -- one ledger row per referral
);

create index if not exists affiliate_bounties_affiliate_idx
    on public.affiliate_bounties (affiliate_wallet_hash);

-- ----------------------------------------------------------------------------
-- 4) Zero-trust lockdown. RLS on, NO policies -> anon + authenticated denied; only
--    service_role (the route handlers) bypasses RLS.
-- ----------------------------------------------------------------------------
alter table public.disperse_receipts  enable row level security;
alter table public.affiliate_bounties enable row level security;

-- ----------------------------------------------------------------------------
-- 5) RECORD DISPERSE RECEIPTS — bulk insert one row per recipient from a VERIFIED
--    disperse tx. The route has already decoded + verified the tx on-chain
--    (verifyDisperseTx) and salt-hashed each recipient; this only persists. Paired
--    arrays (recipient hash <-> amount) are zipped via multi-arg unnest. Idempotent
--    via the (txid, recipient_wallet_hash) unique + ON CONFLICT DO NOTHING.
-- ----------------------------------------------------------------------------
create or replace function public.record_disperse_receipts(
    p_txid             text,
    p_payer            text,
    p_network          text,
    p_block_ts         timestamptz,
    p_recipient_hashes text[],
    p_amounts          text[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer;
begin
    if coalesce(array_length(p_recipient_hashes, 1), 0)
       <> coalesce(array_length(p_amounts, 1), 0) then
        raise exception 'record_disperse_receipts: recipient/amount length mismatch';
    end if;

    insert into public.disperse_receipts
        (recipient_wallet_hash, payer_wallet, amount_base_units, txid, batch_id, network, block_ts)
    select t.h, p_payer, t.a, p_txid, p_txid, p_network, p_block_ts
      from unnest(p_recipient_hashes, p_amounts) as t(h, a)
    on conflict (txid, recipient_wallet_hash) do nothing;

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) AFFILIATE RECEIPTS — a payee's own history, newest first. Keyed STRICTLY on the
--    caller-supplied hash (which the route derives from the PROVEN signer, never a
--    URL). Orders by block_ts, falling back to recorded_at when the chain ts is
--    absent.
-- ----------------------------------------------------------------------------
create or replace function public.affiliate_receipts(p_recipient_wallet_hash text)
returns table (
    payer_wallet      text,
    amount_base_units text,
    txid              text,
    network           text,
    block_ts          timestamptz,
    recorded_at       timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    select r.payer_wallet, r.amount_base_units, r.txid, r.network, r.block_ts, r.recorded_at
      from public.disperse_receipts r
     where r.recipient_wallet_hash = p_recipient_wallet_hash
     order by coalesce(r.block_ts, r.recorded_at) desc, r.id desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) ENSURE AFFILIATE ACCOUNT — mint/fetch the affiliate's opaque code AND mark the
--    row is_affiliate. Reuses the referral_accounts code space (same 23505-retry
--    semantics as ensure_referral_account: a fresh code that already belongs to a
--    DIFFERENT wallet raises unique_violation -> the Node caller retries a new code).
--    The no-op referral_code self-set makes RETURNING report the existing code on a
--    wallet_hash conflict.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_affiliate_account(
    p_wallet_hash text,
    p_code        text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_code text;
begin
    insert into public.referral_accounts (wallet_hash, referral_code, is_affiliate)
    values (p_wallet_hash, p_code, true)
    on conflict (wallet_hash) do update
        set is_affiliate   = true,
            referral_code  = referral_accounts.referral_code
    returning referral_code into v_code;
    return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) RECORD AFFILIATE BOUNTY — the grant-only ledger write, called from the referral
--    claim path AFTER attribution. Inserts a bounty row ONLY IF the referrer code
--    resolves to an AFFILIATE row (is_affiliate = true) and it isn't a self-referral.
--    Never raises on a "no bounty" condition (unknown code / not an affiliate / self)
--    -> returns false, so a claim is never broken by a missing bounty. Idempotent via
--    the (affiliate, referred agency) unique + ON CONFLICT DO NOTHING.
--
--    This CANNOT deny anything: it only ever inserts a ledger row. The receipts read
--    (affiliate_receipts) never touches this table.
-- ----------------------------------------------------------------------------
create or replace function public.record_affiliate_bounty(
    p_referrer_code text,
    p_referee_hash  text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_affiliate_hash text;
begin
    if p_referrer_code is null or p_referee_hash is null then
        return false;
    end if;

    select wallet_hash into v_affiliate_hash
      from public.referral_accounts
     where referral_code = p_referrer_code
       and is_affiliate = true;

    if v_affiliate_hash is null then
        return false;                 -- unknown code OR not an affiliate -> no bounty
    end if;
    if v_affiliate_hash = p_referee_hash then
        return false;                 -- self-referral -> no bounty
    end if;

    insert into public.affiliate_bounties
        (referral_code, affiliate_wallet_hash, referred_agency_wallet_hash)
    values (p_referrer_code, v_affiliate_hash, p_referee_hash)
    on conflict (affiliate_wallet_hash, referred_agency_wallet_hash) do nothing;

    return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) AFFILIATE BOUNTY SUMMARY — the portal's pending-earnings read. Sums ACTIVE
--    ledger rows for the affiliate: how many agencies they referred, months paid out
--    so far, and the accrued (pending, owner-settled) total. Zero rows -> all zeros.
-- ----------------------------------------------------------------------------
create or replace function public.affiliate_bounty_summary(p_wallet_hash text)
returns table (
    referred_count     integer,
    months_paid_total  integer,
    accrued_total      numeric
)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    select count(*)::integer,
           coalesce(sum(b.months_paid), 0)::integer,
           coalesce(sum(b.accrued_amount), 0)::numeric
      from public.affiliate_bounties b
     where b.affiliate_wallet_hash = p_wallet_hash
       and b.status = 'active';
end;
$$;

-- ----------------------------------------------------------------------------
-- 10) Grants. service_role (BYPASSRLS) skips POLICIES but not table-level GRANTs. The
--     functions are SECURITY INVOKER, so they run as the caller (service_role) and
--     need table DML. RPC execute revoked from PUBLIC (anon + authenticated), granted
--     to service_role only.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.disperse_receipts  to service_role;
grant select, insert, update, delete on public.affiliate_bounties to service_role;

revoke all on function public.record_disperse_receipts(text, text, text, timestamptz, text[], text[]) from public;
revoke all on function public.affiliate_receipts(text)                     from public;
revoke all on function public.ensure_affiliate_account(text, text)         from public;
revoke all on function public.record_affiliate_bounty(text, text)          from public;
revoke all on function public.affiliate_bounty_summary(text)               from public;

grant execute on function public.record_disperse_receipts(text, text, text, timestamptz, text[], text[]) to service_role;
grant execute on function public.affiliate_receipts(text)                  to service_role;
grant execute on function public.ensure_affiliate_account(text, text)      to service_role;
grant execute on function public.record_affiliate_bounty(text, text)       to service_role;
grant execute on function public.affiliate_bounty_summary(text)            to service_role;

-- Reload the PostgREST schema cache so the new RPCs/grants resolve over the API.
notify pgrst, 'reload schema';
