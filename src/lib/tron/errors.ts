import { ERROR_SELECTORS } from "./abi"
import { NETWORK } from "./config"

// Every failure the money path can hit, mapped to a calm, honest, actionable
// sentence. The rule (3 Laws, zero-fear): the user NEVER sees "REVERT opcode
// executed" or a raw stack. And every message about a failed batch states the
// truth plainly — nobody was paid — because the disperse is atomic and a
// half-paid batch is impossible.

export type ErrorKind =
  | "no-wallet"
  | "rejected"
  | "wrong-network"
  | "locked"
  | "insufficient-balance"
  | "insufficient-allowance"
  | "out-of-energy"
  | "out-of-time"
  | "reverted"
  | "rpc"
  | "unknown"

export class PurserError extends Error {
  readonly kind: ErrorKind
  /** Non-scary technical detail for logs/debugging — never rendered as-is. */
  readonly technical?: string
  constructor(kind: ErrorKind, message: string, technical?: string) {
    super(message)
    this.name = "PurserError"
    this.kind = kind
    this.technical = technical
  }
}

const WRONG_NETWORK_MSG = `Your wallet is on the wrong network. Switch it to ${NETWORK.name}, then reconnect.`

// --- Wallet / flow errors (thrown from wallet + disperse orchestration) ------

export const noWallet = () =>
  new PurserError(
    "no-wallet",
    "No TRON wallet detected. Install TronLink to connect and pay."
  )

export const userRejected = () =>
  new PurserError("rejected", "You declined the request in your wallet — nothing was sent.")

export const walletLocked = () =>
  new PurserError("locked", "Your wallet is locked. Unlock TronLink, then try again.")

export const wrongNetwork = () => new PurserError("wrong-network", WRONG_NETWORK_MSG)

export const rpcUnreachable = (technical?: string) =>
  new PurserError(
    "rpc",
    "Couldn't reach the network. Nobody was paid — check your connection and try again.",
    technical
  )

// --- On-chain revert decoding ------------------------------------------------

/** Decode a mined-but-reverted tx's contractResult into a calm PurserError.
 *  `contractResult` is the raw hex (no 0x) from receipt.contractResult[0]; the
 *  leading 4 bytes are the custom-error selector. When the guard is per-index
 *  (ZeroAddress/ZeroAmount) we pull the row index and, if given the batch's
 *  recipient labels, name the exact payee. */
export function decodeRevert(
  contractResult: string | undefined,
  rowLabels?: string[]
): PurserError {
  if (!contractResult) {
    return new PurserError(
      "reverted",
      "The payment didn't go through — nobody in this batch was paid. Please try again."
    )
  }

  const selector = "0x" + contractResult.slice(0, 8)
  const spec = ERROR_SELECTORS[selector]

  if (!spec) {
    return new PurserError(
      "reverted",
      "The payment didn't go through — nobody in this batch was paid. Please try again.",
      `unmapped selector ${selector}`
    )
  }

  // Per-index guards: the first uint256 arg is the offending recipient index.
  let who = ""
  if (spec.indexHint) {
    try {
      const idx = Number(BigInt("0x" + contractResult.slice(8, 8 + 64)))
      const label = rowLabels?.[idx]
      who = label ? ` (${label})` : ` #${idx + 1}`
    } catch {
      /* index unreadable — fall back to a generic message */
    }
  }

  switch (spec.name) {
    case "ERC20InsufficientAllowance":
      return new PurserError(
        "insufficient-allowance",
        "The approved amount didn't cover this batch — nobody was paid. Approve the full amount and try again."
      )
    case "ERC20InsufficientBalance":
      return new PurserError(
        "insufficient-balance",
        "Your USDT balance didn't cover this batch — nobody was paid. Top up and try again."
      )
    case "ZeroAddressRecipient":
      return new PurserError(
        "reverted",
        `Recipient${who} has an empty address — nobody in this batch was paid. Fix the address and try again.`
      )
    case "ZeroAmount":
      return new PurserError(
        "reverted",
        `Recipient${who} has a zero amount — nobody in this batch was paid. Set an amount and try again.`
      )
    case "EmptyBatch":
      return new PurserError(
        "reverted",
        "That batch had no one to pay — nobody was paid."
      )
    case "InvalidPlan":
      return new PurserError(
        "reverted",
        "That subscription plan isn't valid — nothing was charged. Please pick monthly or annual and try again."
      )
    case "LengthMismatch":
      return new PurserError(
        "reverted",
        "Something was off with the payout list — nobody was paid. Please try again."
      )
    default:
      return new PurserError(
        "reverted",
        "The payment didn't go through — nobody in this batch was paid. Please try again."
      )
  }
}

/** Map a TRON receipt `result` that isn't SUCCESS/REVERT (energy/time limits)
 *  to a calm PurserError. */
export function fromReceiptResult(result: string): PurserError {
  switch (result) {
    case "OUT_OF_ENERGY":
      return new PurserError(
        "out-of-energy",
        "The transaction couldn't finish in one go — nobody was paid. Try a smaller batch."
      )
    case "OUT_OF_TIME":
      return new PurserError(
        "out-of-time",
        "That batch was too large to finish in one transaction — nobody was paid. Purser will split it smaller."
      )
    default:
      return new PurserError(
        "reverted",
        "The payment didn't go through — nobody in this batch was paid. Please try again.",
        `receipt result ${result}`
      )
  }
}

/** Best-effort classify an unknown thrown value (wallet SDK, fetch, tronweb)
 *  into a calm PurserError. Wallet-rejection codes/strings are recognized so a
 *  user cancelling never reads like a crash. */
export function humanize(err: unknown): PurserError {
  if (err instanceof PurserError) return err

  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err)

  const low = raw.toLowerCase()
  if (low.includes("declined") || low.includes("rejected") || low.includes("cancel") || low.includes("4001")) {
    return userRejected()
  }
  if (low.includes("network") && low.includes("fetch")) return rpcUnreachable(raw)
  if (low.includes("timeout") || low.includes("timed out")) return rpcUnreachable(raw)

  return new PurserError(
    "unknown",
    "Something went wrong and nobody was paid. Please try again.",
    raw
  )
}
