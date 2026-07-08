import { PURSERPAY_ABI } from "./abi"
import type { InjectedTronWeb } from "./client"
import { getInjectedTronWeb } from "./client"
import {
  feeLimitForBatch,
  NETWORK,
  PENDING_DEPLOYMENT_ADDRESS,
  PURSERPAY_ADDRESS,
  SUBSCRIPTION_PRICE_UNITS,
} from "./config"
import {
  APPROVE_FEE_LIMIT_SUN,
  erc20,
  requireWallet,
  waitForReceipt,
  type ContractAbiParam,
} from "./disperse"
import {
  decodeRevert,
  fromReceiptResult,
  humanize,
  PurserError,
  rpcUnreachable,
} from "./errors"

// The on-chain subscription — the app's paywall, paid to the PurserPay contract.
//
// This is a BUSINESS gate, not a security one: PurserPay.disperse() is free and
// never checks a subscription (the ownerless / no-money-transmitter design).
// The gate lives entirely in the frontend, and — like every write here — the
// user's OWN wallet signs and broadcasts; Purser never holds a key.
//
// PurserPay is not deployed yet, so PURSERPAY_ADDRESS is a placeholder. Until a
// real address is set, the gate is fail-closed: reads report "not active" and a
// subscribe surfaces a calm "not deployed yet" message. It can never silently
// open.

/** PurserPay contract bound to the injected wallet (subscribe + reads). */
function purserPay(tw: InjectedTronWeb) {
  return tw.contract(PURSERPAY_ABI as ContractAbiParam, PURSERPAY_ADDRESS)
}

/** True once a real PurserPay address has replaced the deployment placeholder. */
export function isPurserPayDeployed(): boolean {
  return PURSERPAY_ADDRESS !== PENDING_DEPLOYMENT_ADDRESS
}

/** Coerce tronweb's varied bool return shapes to a boolean. */
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v
  if (typeof v === "string") return v === "true" || v === "1"
  if (typeof v === "number") return v !== 0
  if (typeof v === "bigint") return v !== 0n
  return Boolean(v)
}

export type SubscriptionStatus = { deployed: boolean; active: boolean }

/**
 * Read whether `account` has an active subscription on PurserPay.
 *
 * Fail-closed: when the contract isn't deployed yet we return `active: false`
 * WITHOUT a chain call (an expected state, not an error), so the paywall shows.
 * A read failure throws `rpcUnreachable` — the caller must treat that as "can't
 * confirm → not subscribed", never as active.
 */
export async function getSubscriptionStatus(
  account: string
): Promise<SubscriptionStatus> {
  if (!isPurserPayDeployed()) {
    return { deployed: false, active: false }
  }
  const tw = getInjectedTronWeb()
  if (!tw) return { deployed: true, active: false }
  try {
    const raw = await purserPay(tw).isSubscriptionActive(account).call()
    return { deployed: true, active: toBool(raw) }
  } catch (e) {
    throw rpcUnreachable(String(e))
  }
}

export type SubscribeEvents = {
  /** An approve is needed and about to be requested. */
  onApproveStart?: () => void
  /** The subscribe tx is waiting for the user's signature in the wallet. */
  onSigning?: () => void
  /** Signed and broadcast; now confirming on-chain. */
  onConfirming?: (txid: string) => void
}

export type SubscribeOutcome = { approveTxid?: string; txid: string }

/**
 * Run the subscription: approve 250 USDT to PurserPay if the standing allowance
 * is short, then call `subscribe()` (which pulls exactly 250 USDT to the
 * treasury and records the expiry). Confirms each tx by receipt, exactly like
 * the disperse path, and decodes any revert into a calm message.
 *
 * Throws a calm PurserError if PurserPay isn't deployed yet — nothing is signed.
 */
export async function runSubscribe(
  operator: string,
  events: SubscribeEvents = {},
  signal?: AbortSignal
): Promise<SubscribeOutcome> {
  if (!isPurserPayDeployed()) {
    throw new PurserError(
      "unknown",
      `Purser Pay isn't deployed on ${NETWORK.name} yet, so the subscription can't be completed. Your details were saved — this unlocks with the on-chain billing launch.`
    )
  }

  const tw = requireWallet()

  // Approve the flat price to PurserPay if the existing allowance is short.
  // (Mainnet USDT-TRC20 requires resetting a non-zero allowance to 0 first —
  // flag for the mainnet switch; the Nile mock needs no reset.)
  let currentAllowance: bigint
  try {
    const raw = await erc20(tw).allowance(operator, PURSERPAY_ADDRESS).call()
    currentAllowance =
      typeof raw === "bigint" ? raw : BigInt(String(raw ?? "0"))
  } catch (e) {
    throw rpcUnreachable(String(e))
  }

  const outcome: SubscribeOutcome = { txid: "" }

  if (currentAllowance < SUBSCRIPTION_PRICE_UNITS) {
    events.onApproveStart?.()
    let approveTxid: string
    try {
      approveTxid = await erc20(tw)
        .approve(PURSERPAY_ADDRESS, SUBSCRIPTION_PRICE_UNITS.toString())
        .send({ feeLimit: APPROVE_FEE_LIMIT_SUN })
    } catch (e) {
      throw humanize(e)
    }
    const rc = await waitForReceipt(tw, approveTxid, signal)
    if (rc.result !== "SUCCESS") {
      throw rc.result === "REVERT"
        ? decodeRevert(rc.contractResult?.[0])
        : fromReceiptResult(rc.result)
    }
    outcome.approveTxid = approveTxid
  }

  events.onSigning?.()
  let txid: string
  try {
    // subscribe() is a single transferFrom + a storage write — feeLimitForBatch(1)
    // (sized for one fresh transfer) is a comfortable ceiling; only real usage burns.
    txid = await purserPay(tw)
      .subscribe()
      .send({ feeLimit: feeLimitForBatch(1) })
  } catch (e) {
    throw humanize(e)
  }

  events.onConfirming?.(txid)
  const rc = await waitForReceipt(tw, txid, signal)
  if (rc.result !== "SUCCESS") {
    throw rc.result === "REVERT"
      ? decodeRevert(rc.contractResult?.[0])
      : fromReceiptResult(rc.result)
  }

  outcome.txid = txid
  return outcome
}
