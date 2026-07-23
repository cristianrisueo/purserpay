import { getInjectedTronWeb } from "./client"
import type { WalletResources } from "../security/resourceCheck"

// Live wallet-resource read for the payout resource pre-check (Sprint: toolbar resource pre-check).
//
// Reads the OPERATOR's OWN energy / bandwidth / TRX plus the live chain fee params through the
// INJECTED TronLink provider — exactly like getUsdtBalance (disperse.ts) reads the operator's USDT
// balance. Client-side is correct here: it's the operator's own wallet (only relevant once
// connected), and the injected provider has its own node access, so mainnet's keyless-read 429 never
// applies (that afflicts our app-owned readClient, not TronLink's). Read-only: nothing signed, no
// key, no funds move — non-custodial untouched. Any failure → null (the pre-check renders "unknown"
// and never blocks — never a false "you're covered").

type AccountResources = {
  EnergyLimit?: number
  EnergyUsed?: number
  freeNetLimit?: number
  freeNetUsed?: number
  NetLimit?: number
  NetUsed?: number
}

type ChainParam = { key?: string; value?: number }

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The operator's live resources + chain fee params, or null if any read fails. energyFee /
 * transactionFee are read LIVE (governance params) — never assumed 100 / 1000 sun. A missing fee
 * param makes the whole read "unavailable" (null) rather than guessing a stale default.
 */
export async function getWalletResources(operator: string): Promise<WalletResources | null> {
  const tw = getInjectedTronWeb()
  if (!tw) return null
  try {
    const [resRaw, balanceRaw, paramsRaw] = await Promise.all([
      tw.trx.getAccountResources(operator),
      tw.trx.getBalance(operator),
      tw.trx.getChainParameters(),
    ])
    const res = (resRaw ?? {}) as AccountResources
    const params = (paramsRaw ?? []) as ChainParam[]

    const energyAvailable = Math.max(0, num(res.EnergyLimit) - num(res.EnergyUsed))
    // Bandwidth comes from two pools: the daily FREE allowance and any staked/frozen bandwidth.
    const freeNet = num(res.freeNetLimit) - num(res.freeNetUsed)
    const stakedNet = num(res.NetLimit) - num(res.NetUsed)
    const bandwidthAvailable = Math.max(0, freeNet) + Math.max(0, stakedNet)

    const paramValue = (key: string): number | null => {
      const p = params.find((x) => x?.key === key)
      return p && p.value != null ? num(p.value) : null
    }
    const energyFeeSun = paramValue("getEnergyFee")
    const txFeeSun = paramValue("getTransactionFee")
    if (energyFeeSun == null || txFeeSun == null) return null

    return {
      energyAvailable,
      bandwidthAvailable,
      trxSun: num(balanceRaw),
      energyFeeSun,
      txFeeSun,
    }
  } catch {
    return null
  }
}
