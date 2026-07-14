import { ERC20_ABI, PURSERPAY_ABI } from "./abi"
import { ensureAllowance } from "./allowance"
import type { InjectedTronWeb } from "./client"
import { getInjectedTronWeb } from "./client"
import {
  BATCH_CAP,
  DISPERSE_ADDRESS,
  feeLimitForBatch,
  FEE_FLOOR_SUN,
  USDT_ADDRESS,
} from "./config"
import { toBaseUnits } from "./amount"
import {
  decodeRevert,
  fromReceiptResult,
  humanize,
  noWallet,
  PurserError,
  rpcUnreachable,
} from "./errors"

// The approve → disperse money path. Every write goes through the injected
// (TronLink) TronWeb, so the user's OWN wallet signs and broadcasts — Purser
// never holds a key and never propagates a transaction on the user's behalf.
//
// A disperse is atomic: the whole batch confirms or the whole batch reverts,
// and this module only ever reports a batch "confirmed" once its on-chain
// receipt says SUCCESS. A half-batch, or a "paid" that didn't move money, is
// structurally impossible here.

/** The tronweb .contract() abi param type, derived from the instance so we
 *  don't couple to tronweb's internal type paths. Exported so subscription.ts
 *  binds PurserPay the same way. */
export type ContractAbiParam = Parameters<InjectedTronWeb["contract"]>[0]

/** Approve is cheap; 50 TRX ceiling. Reused by the subscription approve. */
export const APPROVE_FEE_LIMIT_SUN = FEE_FLOOR_SUN
const RECEIPT_POLL_TRIES = 40
const RECEIPT_POLL_MS = 2_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Normalize tronweb's varied numeric return shapes to a bigint. */
export function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v
  if (typeof v === "number") return BigInt(Math.trunc(v))
  if (typeof v === "string") return BigInt(v)
  if (v && typeof (v as { toString?: unknown }).toString === "function") {
    return BigInt((v as { toString(): string }).toString())
  }
  return 0n
}

export function requireWallet(): InjectedTronWeb {
  const tw = getInjectedTronWeb()
  if (!tw || !tw.defaultAddress?.base58) throw noWallet()
  return tw
}

/** USDT (TRC20) contract bound to the injected wallet. Reused for the
 *  subscription approve, whose spender is the PurserPay contract. */
export function erc20(tw: InjectedTronWeb) {
  return tw.contract(ERC20_ABI as ContractAbiParam, USDT_ADDRESS)
}
function disperseContract(tw: InjectedTronWeb) {
  return tw.contract(PURSERPAY_ABI as ContractAbiParam, DISPERSE_ADDRESS)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// --- Reads -------------------------------------------------------------------

/** Operator's USDT balance in base units. */
export async function getUsdtBalance(operator: string): Promise<bigint> {
  const tw = getInjectedTronWeb()
  if (!tw) return 0n
  try {
    const raw = await erc20(tw).balanceOf(operator).call()
    return toBig(raw)
  } catch (e) {
    throw rpcUnreachable(String(e))
  }
}

/** Current allowance the operator has granted the disperse contract. */
export async function getAllowance(operator: string): Promise<bigint> {
  const tw = getInjectedTronWeb()
  if (!tw) return 0n
  try {
    const raw = await erc20(tw).allowance(operator, DISPERSE_ADDRESS).call()
    return toBig(raw)
  } catch (e) {
    throw rpcUnreachable(String(e))
  }
}

// --- Receipt polling ---------------------------------------------------------

export type Receipt = { result: string; contractResult?: string[] }

/** Poll until the tx is mined, then return its normalized result. TRON omits
 *  `receipt.result` on a plain success, so absence == SUCCESS once mined.
 *  Exported so the subscription flow confirms its approve/subscribe txs the
 *  same way. */
export async function waitForReceipt(
  tw: InjectedTronWeb,
  txid: string,
  signal?: AbortSignal
): Promise<Receipt> {
  for (let i = 0; i < RECEIPT_POLL_TRIES; i++) {
    if (signal?.aborted) throw new PurserError("unknown", "Cancelled.")
    let info: {
      id?: string
      receipt?: { result?: string }
      contractResult?: string[]
      result?: string
    }
    try {
      info = await tw.trx.getTransactionInfo(txid)
    } catch {
      info = {}
    }
    if (info && info.id) {
      const result =
        info.receipt?.result ?? (info.result === "FAILED" ? "REVERT" : "SUCCESS")
      return { result, contractResult: info.contractResult }
    }
    await sleep(RECEIPT_POLL_MS)
  }
  throw rpcUnreachable(`receipt timeout for ${txid}`)
}

// --- Orchestration -----------------------------------------------------------

export type DisperseRow = { id: string; address: string; amount: number }

export type ConfirmedBatch = {
  txid: string
  batchIndex: number
  totalBatches: number
  rowIds: string[]
  recipients: { id: string; address: string; amount: number }[]
  /** stringified bigint of the batch total in base units. */
  totalBaseUnits: string
}

export type DisperseEvents = {
  /** An approve is needed and about to be requested. */
  onApproveStart?: () => void
  /** A non-zero, insufficient allowance must be reset to 0 first (mainnet
   *  USDT-TRC20 rule) — the user will see an EXTRA wallet prompt. */
  onApproveReset?: () => void
  onApproveConfirmed?: (txid: string) => void
  /** A batch is waiting for the user's signature in the wallet. */
  onBatchSigning?: (batchIndex: number, totalBatches: number, rowIds: string[]) => void
  /** Signed and broadcast; now confirming on-chain. */
  onBatchPending?: (
    batchIndex: number,
    totalBatches: number,
    txid: string,
    rowIds: string[]
  ) => void
  onBatchConfirmed?: (batch: ConfirmedBatch) => void
  onBatchFailed?: (
    batchIndex: number,
    totalBatches: number,
    rowIds: string[],
    error: PurserError
  ) => void
}

export type DisperseOutcome = {
  approveTxid?: string
  confirmed: ConfirmedBatch[]
  /** Set when the run stopped early on a failure. Already-confirmed batches
   *  above are real and paid; everything in/after the failed batch is not. */
  failure?: { batchIndex: number; error: PurserError }
}

/**
 * Run a full payout: convert amounts, split into ≤BATCH_CAP signatures,
 * approve once for the grand total (skipped if the existing allowance already
 * covers it), then disperse each chunk. Stops at the first failure — every
 * batch already reported confirmed is genuinely on-chain; nothing in or after a
 * failed batch is ever reported paid (atomicity, no false green).
 */
export async function runDisperse(
  operator: string,
  rows: DisperseRow[],
  events: DisperseEvents = {},
  signal?: AbortSignal
): Promise<DisperseOutcome> {
  const tw = requireWallet()

  // Exact base-unit conversion up front — a bad amount fails here, before any
  // signature, naming the row.
  const withUnits = rows.map((r) => {
    try {
      return { ...r, units: toBaseUnits(r.amount) }
    } catch (e) {
      throw humanize(e)
    }
  })

  const grandTotal = withUnits.reduce((a, r) => a + r.units, 0n)
  const batches = chunk(withUnits, BATCH_CAP)
  const totalBatches = batches.length
  const confirmed: ConfirmedBatch[] = []
  const outcome: DisperseOutcome = { confirmed }

  // Approve once for the whole run if the standing allowance is short. Fewer
  // signatures = closer to the ≤3-click law. ensureAllowance handles mainnet
  // USDT-TRC20's require(allowance == 0 || value == 0): a non-zero-but-short
  // allowance is reset to 0 first (an extra prompt, announced via onApproveReset)
  // before re-approving. The Nile mock has no such rule, so its path is unchanged.
  const currentAllowance = await getAllowance(operator)
  const { approveTxid } = await ensureAllowance(
    currentAllowance,
    grandTotal,
    DISPERSE_ADDRESS,
    {
      approve: async (spender, value) => {
        try {
          return await erc20(tw)
            .approve(spender, value.toString())
            .send({ feeLimit: APPROVE_FEE_LIMIT_SUN })
        } catch (e) {
          throw humanize(e)
        }
      },
      confirm: async (txid) => {
        const rc = await waitForReceipt(tw, txid, signal)
        if (rc.result !== "SUCCESS") {
          throw rc.result === "REVERT"
            ? decodeRevert(rc.contractResult?.[0])
            : fromReceiptResult(rc.result)
        }
      },
    },
    { onApproveStart: events.onApproveStart, onApproveReset: events.onApproveReset }
  )
  if (approveTxid) {
    outcome.approveTxid = approveTxid
    events.onApproveConfirmed?.(approveTxid)
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const rowIds = batch.map((r) => r.id)
    const labels = batch.map((r) => r.address)

    events.onBatchSigning?.(b, totalBatches, rowIds)

    let txid: string
    try {
      txid = await disperseContract(tw)
        .disperse(
          USDT_ADDRESS,
          batch.map((r) => r.address),
          batch.map((r) => r.units.toString())
        )
        .send({ feeLimit: feeLimitForBatch(batch.length) })
    } catch (e) {
      const err = humanize(e)
      events.onBatchFailed?.(b, totalBatches, rowIds, err)
      outcome.failure = { batchIndex: b, error: err }
      return outcome
    }

    events.onBatchPending?.(b, totalBatches, txid, rowIds)

    let rc: Receipt
    try {
      rc = await waitForReceipt(tw, txid, signal)
    } catch (e) {
      const err = humanize(e)
      events.onBatchFailed?.(b, totalBatches, rowIds, err)
      outcome.failure = { batchIndex: b, error: err }
      return outcome
    }

    if (rc.result !== "SUCCESS") {
      const err =
        rc.result === "REVERT"
          ? decodeRevert(rc.contractResult?.[0], labels)
          : fromReceiptResult(rc.result)
      events.onBatchFailed?.(b, totalBatches, rowIds, err)
      outcome.failure = { batchIndex: b, error: err }
      return outcome
    }

    const cb: ConfirmedBatch = {
      txid,
      batchIndex: b,
      totalBatches,
      rowIds,
      recipients: batch.map((r) => ({ id: r.id, address: r.address, amount: r.amount })),
      totalBaseUnits: batch.reduce((a, r) => a + r.units, 0n).toString(),
    }
    confirmed.push(cb)
    events.onBatchConfirmed?.(cb)
  }

  return outcome
}
