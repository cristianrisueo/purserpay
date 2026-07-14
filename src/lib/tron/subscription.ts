import { PURSERPAY_ABI } from "./abi"
import { ensureAllowance } from "./allowance"
import type { InjectedTronWeb } from "./client"
import { readClient } from "./client"
import {
  feeLimitForBatch,
  NETWORK,
  PENDING_DEPLOYMENT_ADDRESS,
  priceUnitsForPlan,
  PURSERPAY_ADDRESS,
  type SubscriptionPlan,
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
  fromSubscribeReceiptResult,
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

export type SubscriptionStatus = {
  deployed: boolean
  active: boolean
  /** Expiry in ms since epoch, or null when undeployed / never subscribed. */
  expiresAt: number | null
}

/** Coerce tronweb's varied uint256 return shapes to a JS number of ms, or null. */
function toExpiryMs(raw: unknown): number | null {
  let seconds: number
  if (typeof raw === "bigint") seconds = Number(raw)
  else if (typeof raw === "number") seconds = raw
  else seconds = Number(String(raw ?? "0"))
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

/**
 * Read whether `account` has an active subscription on PurserPay, plus its expiry.
 *
 * Read over the app's own KEYLESS node (never the injected wallet):
 * `subscriptionExpiresAt` is a public view, so it needs no signer — and reading it
 * through the user's wallet is what made the public landing touch TronLink on load
 * (an authorized-but-locked wallet would prompt to unlock). `account` is only the
 * constant-call `from` — nothing is signed, no funds move, no prompt is ever raised.
 *
 * Fail-closed: when the contract isn't deployed yet we return `active: false`
 * WITHOUT a chain call (an expected state, not an error), so the paywall shows.
 * A read failure throws `rpcUnreachable` — the caller must treat that as "can't
 * confirm → not subscribed", never as active. `active` is derived from the expiry
 * so a single `subscriptionExpiresAt` read yields both.
 */
export async function getSubscriptionStatus(
  account: string
): Promise<SubscriptionStatus> {
  if (!isPurserPayDeployed()) {
    return { deployed: false, active: false, expiresAt: null }
  }
  try {
    const tw = readClient()
    const res = (await tw.transactionBuilder.triggerConstantContract(
      PURSERPAY_ADDRESS,
      "subscriptionExpiresAt(address)",
      {},
      [{ type: "address", value: account }],
      account
    )) as { result?: { result?: boolean }; constant_result?: string[] }
    if (!res?.result?.result) {
      throw new Error("subscriptionExpiresAt read failed")
    }
    const hex = res.constant_result?.[0]
    const expiresAt = toExpiryMs(hex ? BigInt("0x" + hex) : 0n)
    return {
      deployed: true,
      active: expiresAt != null && expiresAt > Date.now(),
      expiresAt,
    }
  } catch (e) {
    throw rpcUnreachable(String(e))
  }
}

export type SubscribeEvents = {
  /** An approve is needed and about to be requested. */
  onApproveStart?: () => void
  /** A non-zero, insufficient allowance must be reset to 0 first (mainnet
   *  USDT-TRC20 rule) — the user will see an EXTRA wallet prompt. */
  onApproveReset?: () => void
  /** The subscribe tx is waiting for the user's signature in the wallet. */
  onSigning?: () => void
  /** Signed and broadcast; now confirming on-chain. */
  onConfirming?: (txid: string) => void
}

export type SubscribeOutcome = { approveTxid?: string; txid: string }

/**
 * Run the subscription for a plan: approve the plan's price to PurserPay if the
 * standing allowance is short, then call `subscribe(planType)` (which pulls exactly
 * that price to the treasury and records the expiry). Confirms each tx by receipt,
 * exactly like the disperse path, and decodes any revert into a calm message.
 *
 * @param plan 0 = monthly (150 USDT / 30d), 1 = annual (1,500 USDT / 365d).
 *
 * Throws a calm PurserError if PurserPay isn't deployed yet — nothing is signed.
 */
export async function runSubscribe(
  operator: string,
  plan: SubscriptionPlan,
  events: SubscribeEvents = {},
  signal?: AbortSignal
): Promise<SubscribeOutcome> {
  if (!isPurserPayDeployed()) {
    throw new PurserError(
      "unknown",
      `PurserPay isn't deployed on ${NETWORK.name} yet, so the subscription can't be completed. Your details were saved — this unlocks with the on-chain billing launch.`
    )
  }

  const tw = requireWallet()
  const priceUnits = priceUnitsForPlan(plan)

  // Approve the plan's price to PurserPay if the existing allowance is short.
  // ensureAllowance handles mainnet USDT-TRC20's require(allowance == 0 || value
  // == 0): a non-zero-but-short allowance (e.g. left over from a monthly attempt,
  // now switching to annual) is reset to 0 first — an EXTRA prompt announced via
  // onApproveReset — before re-approving. The Nile mock has no such rule.
  let currentAllowance: bigint
  try {
    const raw = await erc20(tw).allowance(operator, PURSERPAY_ADDRESS).call()
    currentAllowance =
      typeof raw === "bigint" ? raw : BigInt(String(raw ?? "0"))
  } catch (e) {
    throw rpcUnreachable(String(e))
  }

  const outcome: SubscribeOutcome = { txid: "" }

  const { approveTxid } = await ensureAllowance(
    currentAllowance,
    priceUnits,
    PURSERPAY_ADDRESS,
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
            : fromSubscribeReceiptResult(rc.result)
        }
      },
    },
    { onApproveStart: events.onApproveStart, onApproveReset: events.onApproveReset }
  )
  if (approveTxid) outcome.approveTxid = approveTxid

  events.onSigning?.()
  let txid: string
  try {
    // subscribe() is a single transferFrom + a storage write — feeLimitForBatch(1)
    // (sized for one fresh transfer) is a comfortable ceiling; only real usage burns.
    txid = await purserPay(tw)
      .subscribe(plan)
      .send({ feeLimit: feeLimitForBatch(1) })
  } catch (e) {
    throw humanize(e)
  }

  events.onConfirming?.(txid)
  const rc = await waitForReceipt(tw, txid, signal)
  if (rc.result !== "SUCCESS") {
    throw rc.result === "REVERT"
      ? decodeRevert(rc.contractResult?.[0])
      : fromSubscribeReceiptResult(rc.result)
  }

  outcome.txid = txid
  return outcome
}
