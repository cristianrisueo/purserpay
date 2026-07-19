-- ============================================================================
-- PurserPay — 0006_receipt_audit
-- Sprint 1B: the verifiable Audit ID + the public verification read.
--
-- WHAT THIS ADDS (and why):
--   Sprint 1A (0005) built disperse_receipts — a dissociated, forward-only index
--   of who was paid THROUGH PurserPay. 1B turns each row into a downloadable PDF
--   "proof of source of funds" that an affiliate shows an exchange/bank. The proof
--   must be VERIFIABLE, not decorative (anti-Photoshop): the PDF carries a QR to a
--   PUBLIC verification page that shows the real on-chain amount for that batch. If
--   someone fakes an amount and prints, the verification page contradicts it —
--   because the page reads the amount from THIS index (chain-derived), never from
--   the PDF or the URL.
--
-- THE AUDIT ID — deterministic, unforgeable, wallet-hiding:
--     audit_id = 'PP-' || upper(left(sha256(txid || ':' || recipient_wallet_hash), 16))
--   A GENERATED STORED column, so SQL is the ONE source of truth for the formula
--   (Node mirrors it in src/lib/affiliate/auditId.ts for tests/docs only). Because
--   recipient_wallet_hash is the SALTED hash (WALLET_SALT), the Audit ID cannot be
--   forged by an outsider and reveals no wallet. It computes for existing rows
--   automatically (no backfill), so this migration applies cleanly from a virgin DB.
--
--   pgcrypto lives in the `extensions` schema (0001 installed it there), so the
--   generated expression SCHEMA-QUALIFIES extensions.digest — it must resolve
--   regardless of the inserting function's search_path.
--
-- ZERO NEW CLIENT ACCESS. RLS is already on disperse_receipts (0005) with NO
-- policies; only service_role (the route handlers) bypasses it. The verification
-- page reads through a service_role RPC that returns ONLY public-on-chain fields
-- (amount, payer, network, block time) — NEVER the recipient hash.
--
-- Idempotent and safe to re-run. Mirrors the style of 0002–0005. After running,
-- reload the PostgREST schema cache (notify pgrst, 'reload schema';).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) The Audit ID — a generated STORED column on the 1A receipt index. One stable
--    ID per (recipient, disperse tx), derived only from the txid and the salted
--    recipient hash. extensions.digest is schema-qualified so the expression
--    resolves at INSERT time no matter what search_path the caller pinned.
-- ----------------------------------------------------------------------------
alter table public.disperse_receipts
    add column if not exists audit_id text
    generated always as (
        'PP-' || upper(left(
            encode(extensions.digest(txid || ':' || recipient_wallet_hash, 'sha256'), 'hex'),
            16
        ))
    ) stored;

-- The verification lookup path: (txid public, audit_id opaque) -> the one row.
create index if not exists disperse_receipts_verify_idx
    on public.disperse_receipts (txid, audit_id);

-- ----------------------------------------------------------------------------
-- 2) RECEIPT DETAIL — the single row a signed-in payee downloads as a PDF. Keyed
--    STRICTLY on (txid, recipient_wallet_hash) where the hash is the PROVEN
--    signer's (the route derives it AFTER verifyChallenge, never from the body).
--    So `txid` is only a selector WITHIN the signer's own data: a txid the signer
--    was not paid in returns zero rows. Every field the PDF prints comes from here
--    (the chain-derived index), never the request.
-- ----------------------------------------------------------------------------
create or replace function public.receipt_detail(
    p_txid                text,
    p_recipient_wallet_hash text
)
returns table (
    payer_wallet      text,
    amount_base_units text,
    txid              text,
    network           text,
    block_ts          timestamptz,
    recorded_at       timestamptz,
    audit_id          text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    select r.payer_wallet, r.amount_base_units, r.txid, r.network,
           r.block_ts, r.recorded_at, r.audit_id
      from public.disperse_receipts r
     where r.txid = p_txid
       and r.recipient_wallet_hash = p_recipient_wallet_hash
     limit 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) VERIFY RECEIPT — the PUBLIC verification read behind /verify/[txid]?a=…. It
--    takes ONLY (txid, audit_id) and returns the batch facts that are ALREADY
--    public on-chain for that txid: amount, paying agency, network, block time.
--    It NEVER takes an amount (so it can never echo a client's number back) and
--    NEVER returns the recipient hash. The amount it returns is the index truth,
--    which is why a Photoshopped PDF amount is exposed by this page.
-- ----------------------------------------------------------------------------
create or replace function public.verify_receipt(
    p_txid     text,
    p_audit_id text
)
returns table (
    payer_wallet      text,
    amount_base_units text,
    network           text,
    block_ts          timestamptz,
    audit_id          text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
    return query
    select r.payer_wallet, r.amount_base_units, r.network, r.block_ts, r.audit_id
      from public.disperse_receipts r
     where r.txid = p_txid
       and r.audit_id = p_audit_id
     limit 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Grants. SECURITY INVOKER functions run as the caller (service_role), which
--    needs table SELECT (already granted in 0005). RPC execute is revoked from
--    PUBLIC (anon + authenticated) and granted to service_role only — the browser
--    never calls these directly; the route handlers do.
-- ----------------------------------------------------------------------------
revoke all on function public.receipt_detail(text, text)  from public;
revoke all on function public.verify_receipt(text, text)  from public;

grant execute on function public.receipt_detail(text, text) to service_role;
grant execute on function public.verify_receipt(text, text) to service_role;

-- Reload the PostgREST schema cache so the new RPCs/grants resolve over the API.
notify pgrst, 'reload schema';
