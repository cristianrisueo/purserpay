-- ============================================================================
-- PurserPay — 0003_referrals
-- The asymmetric referral loop: opaque codes, off-chain credit (a balance of
-- free months), and idempotent reward accounting.
--
-- THE ONE ANTI-FRAUD PROPERTY — do not break it:
--   Reward (1 month = 150 USDT) == cost of manufacturing a referee (150 USDT
--   paid on-chain). Self-referral is a mathematical x = x, zero margin. NEVER
--   make the reward bigger than the price. See docs/08-referrals-and-credit.md.
--
-- ENTITLEMENT (off-chain, no indexer / cron / listener):
--   entitled(wallet) = onChainActive(wallet) || credit_active_until > now()
--   Credit is a BALANCE of months, consumed LAZILY at pay time — one month is
--   activated (30 days) only when the chain sub is inactive AND no credit month
--   is already running AND a month is banked. Stacking (N referrals = N months
--   queued) needs no background job. The chain stays the source of truth for
--   PAYMENTS; credit is purely additive access on top.
--
-- DATA DISSOCIATION — read before touching this:
--   * wallet_hash is a SALTED SHA-256 hash (same WALLET_SALT pepper + trim-only
--     normalization as the free tier / OFAC — src/lib/crypto.ts). No raw address
--     and NO PII ever lands here. Not FK-linked to billing_profiles; the shared
--     pseudonymous hash reveals no identity (matches free_tier_usage's posture).
--   * referral_code is OPAQUE and RANDOM — NEVER derived from the wallet address
--     (a wallet-as-code would doxx the payout treasury). Generated in Node
--     (src/lib/referral/code.ts, CSPRNG) and passed in.
--   * No TTL/purge: a referral account is the customer's durable referral
--     identity (unlike the 30-day free-tier rows).
--
-- MONOTONIC: this schema can only GRANT access, never DENY it. consume never
-- drops a balance below 0 (CHECK + guarded UPDATE); a reward only ever INCREMENTS.
--
-- ZERO CLIENT ACCESS — RLS on with NO policies; only service_role (the route
-- handlers) bypasses RLS. The browser can never read or write these tables.
--
-- Idempotent and safe to run in the Supabase SQL editor or via `supabase db push`.
-- Mirrors the style of 0002_free_tier_usage.sql. After running, reload the
-- PostgREST schema cache (Supabase does this on save, or run:
--   notify pgrst, 'reload schema';) so the RPCs below are callable over the API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tables.
--    referral_accounts: one row per wallet that has ever subscribed or been
--    referred. referral_rewards: idempotency + audit for every granted reward.
-- ----------------------------------------------------------------------------
create table if not exists public.referral_accounts (
    wallet_hash            text        primary key,   -- salted SHA-256 (WALLET_SALT)
    referral_code          text        unique not null,       -- opaque, random, NOT wallet-derived
    referred_by_code       text        references public.referral_accounts(referral_code), -- immutable once set
    credit_balance_months  integer     not null default 0 check (credit_balance_months >= 0),
    credit_active_until     timestamptz,
    first_paid_at          timestamptz,               -- set on first VERIFIED on-chain subscribe
    created_at             timestamptz not null default now()
);

create table if not exists public.referral_rewards (
    txid                 text        primary key,      -- the referee's on-chain subscribe tx
    referrer_wallet_hash text        not null references public.referral_accounts(wallet_hash),
    referee_wallet_hash  text        not null unique references public.referral_accounts(wallet_hash), -- ONE reward per referee, EVER
    granted_at           timestamptz not null default now()
);

-- Index the reward → referrer lookup used by referral_summary's count.
create index if not exists referral_rewards_referrer_idx
    on public.referral_rewards (referrer_wallet_hash);

-- ----------------------------------------------------------------------------
-- 2) Zero-trust lockdown. RLS on, NO policies -> anon + authenticated denied;
--    only service_role (the route handlers) bypasses RLS.
-- ----------------------------------------------------------------------------
alter table public.referral_accounts enable row level security;
alter table public.referral_rewards  enable row level security;

-- ----------------------------------------------------------------------------
-- 3) LAZY CODE GENERATION. Upsert the caller's row; return the (existing or new)
--    code. The no-op DO UPDATE lets RETURNING report the existing code on a
--    wallet_hash conflict. A referral_code UNIQUE collision (a fresh code that
--    already belongs to a DIFFERENT wallet) is NOT caught by the wallet_hash
--    ON CONFLICT, so it raises 23505 -> the Node caller retries with a new code.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_referral_account(
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
    insert into public.referral_accounts (wallet_hash, referral_code)
    values (p_wallet_hash, p_code)
    on conflict (wallet_hash) do update
        set referral_code = referral_accounts.referral_code
    returning referral_code into v_code;
    return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) LAZY CREDIT CONSUME — the whole credit-TOCTOU defense.
--    A single guarded UPDATE decrements ONE banked month and starts a 30-day
--    window, but ONLY when activation is allowed (chain sub definitively
--    inactive), no month is already running, and a month is banked. Postgres
--    row-locks the target and re-checks the qual on a concurrent update
--    (EvalPlanQual), so N concurrent callers with balance = 1 decrement EXACTLY
--    once. NEVER a SELECT-then-UPDATE.
--
--    p_allow_activation is false when the chain read was UNVERIFIABLE (null): we
--    then only HONOR an already-running month, never burn a banked one on a
--    wallet that might actually be subscribed on-chain.
--
--    Returns (entitled, active_until):
--      * just activated -> (true,  now()+30d)   -- one month consumed
--      * already running -> (true, existing)     -- NO decrement
--      * none            -> (false, null)        -- fall through to free tier
--    Missing row -> (false, null) (creates nothing).
-- ----------------------------------------------------------------------------
create or replace function public.consume_referral_credit(
    p_wallet_hash      text,
    p_allow_activation boolean
)
returns table (entitled boolean, active_until timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_activated timestamptz;
    v_existing  timestamptz;
begin
    update public.referral_accounts
       set credit_balance_months = credit_balance_months - 1,
           credit_active_until   = now() + interval '30 days'
     where wallet_hash = p_wallet_hash
       and p_allow_activation
       and (credit_active_until is null or credit_active_until <= now())
       and credit_balance_months > 0
    returning credit_active_until into v_activated;

    if v_activated is not null then
        return query select true, v_activated;
        return;
    end if;

    -- Nothing activated — honor an already-running month if present (no decrement).
    select credit_active_until into v_existing
      from public.referral_accounts
     where wallet_hash = p_wallet_hash;

    if v_existing is not null and v_existing > now() then
        return query select true, v_existing;
    else
        return query select false, null::timestamptz;
    end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) CLAIM + GRANT — spec steps 2-7 in ONE transaction. The route has already
--    (a) verified the tx on-chain (real subscribe to OUR contract by the
--    referee) and (b) ensured the referee row exists. Here we, atomically:
--      * mark the referee's first_paid_at (idempotent) and bind referred_by_code
--        immutably (attribution — runs even when rewards are disabled);
--      * grant a reward ONLY IF this was the referee's first paid month AND
--        rewards are enabled AND a referrer code resolves AND it isn't a
--        self-referral AND the referrer is entitled (active-lock).
--
--    A month activated from CREDIT can never reach here — the route requires a
--    verified on-chain subscribe tx, which a credit activation never has. So
--    credit months never generate rewards.
--
--    Idempotent: referral_rewards.txid is the PK and referee_wallet_hash is
--    UNIQUE, so a repeat txid OR a referee's second paid month conflicts -> no
--    double grant.
--
--    Active-lock uses a HASH-COMPUTABLE proxy: we store only the referrer's
--    wallet_hash, so a live on-chain read (which needs the raw address) is
--    impossible here. first_paid_at (set on any verified on-chain subscribe) is
--    the durable "has paid real money" signal; generous here is monotonic-safe.
-- ----------------------------------------------------------------------------
create or replace function public.claim_referral_reward(
    p_txid          text,
    p_referee_hash  text,
    p_referrer_code text,     -- may be null (no attribution cookie)
    p_grant         boolean   -- REFERRALS_ENABLED
)
returns table (granted boolean, reason text)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_was_first     boolean;
    v_referrer_hash text;
    v_ref_first     boolean;
    v_ref_active    timestamptz;
    v_ref_balance   integer;
begin
    -- Lock the referee row (caller ensured it exists).
    select (first_paid_at is null) into v_was_first
      from public.referral_accounts
     where wallet_hash = p_referee_hash
       for update;
    if not found then
        return query select false, 'referee_missing'::text;
        return;
    end if;

    -- Attribution: mark first payment (idempotent) + bind referrer (immutable once set).
    update public.referral_accounts
       set first_paid_at    = coalesce(first_paid_at, now()),
           referred_by_code = coalesce(referred_by_code, p_referrer_code)
     where wallet_hash = p_referee_hash;

    -- Reward gates.
    if not v_was_first then
        return query select false, 'not_first_payment'::text;
        return;
    end if;
    if not p_grant then
        return query select false, 'disabled'::text;
        return;
    end if;
    if p_referrer_code is null then
        return query select false, 'no_referrer'::text;
        return;
    end if;

    select wallet_hash, (first_paid_at is not null), credit_active_until, credit_balance_months
      into v_referrer_hash, v_ref_first, v_ref_active, v_ref_balance
      from public.referral_accounts
     where referral_code = p_referrer_code;

    if v_referrer_hash is null then
        return query select false, 'unknown_code'::text;
        return;
    end if;
    if v_referrer_hash = p_referee_hash then
        return query select false, 'self_referral'::text;
        return;
    end if;

    -- Active-lock: the referrer must be entitled (hash-computable proxy).
    if not (v_ref_first
            or (v_ref_active is not null and v_ref_active > now())
            or v_ref_balance > 0) then
        return query select false, 'referrer_not_entitled'::text;
        return;
    end if;

    -- Idempotent grant: one reward per txid (PK) and per referee (UNIQUE).
    begin
        insert into public.referral_rewards (txid, referrer_wallet_hash, referee_wallet_hash)
        values (p_txid, v_referrer_hash, p_referee_hash);
    exception when unique_violation then
        return query select false, 'already_granted'::text;
        return;
    end;

    update public.referral_accounts
       set credit_balance_months = credit_balance_months + 1
     where wallet_hash = v_referrer_hash;

    return query select true, 'granted'::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) SUMMARY — the dashboard card + client freeMode parity read. Zero rows if
--    the account doesn't exist (callers ensure_referral_account first).
-- ----------------------------------------------------------------------------
create or replace function public.referral_summary(p_wallet_hash text)
returns table (
    referral_code         text,
    credit_balance_months integer,
    credit_active_until   timestamptz,
    qualified_referrals   integer
)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    select a.referral_code,
           a.credit_balance_months,
           a.credit_active_until,
           (select count(*)::integer
              from public.referral_rewards r
             where r.referrer_wallet_hash = a.wallet_hash)
      from public.referral_accounts a
     where a.wallet_hash = p_wallet_hash;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) Grants. service_role (BYPASSRLS) skips POLICIES but not table-level GRANTs.
--    The functions are SECURITY INVOKER, so they run as the caller (service_role)
--    and need table DML. RPC execute revoked from PUBLIC (anon + authenticated),
--    granted to service_role only.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.referral_accounts to service_role;
grant select, insert, update, delete on public.referral_rewards  to service_role;

revoke all on function public.ensure_referral_account(text, text)          from public;
revoke all on function public.consume_referral_credit(text, boolean)       from public;
revoke all on function public.claim_referral_reward(text, text, text, boolean) from public;
revoke all on function public.referral_summary(text)                       from public;

grant execute on function public.ensure_referral_account(text, text)          to service_role;
grant execute on function public.consume_referral_credit(text, boolean)       to service_role;
grant execute on function public.claim_referral_reward(text, text, text, boolean) to service_role;
grant execute on function public.referral_summary(text)                       to service_role;

-- Reload the PostgREST schema cache so the new RPCs/grants resolve over the API.
notify pgrst, 'reload schema';
