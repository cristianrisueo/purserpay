import { TronWeb } from "tronweb"

import { NETWORK } from "./config"

// The TronWeb access layer. Two instances, deliberately kept apart:
//
//  1. readClient() — a keyless, app-owned TronWeb pointed at the public Nile
//     node. Used ONLY for offline utilities (isAddress, base58↔hex) that need
//     no network, and as a last-resort read endpoint. It never signs anything.
//
//  2. getInjectedTronWeb() — the TronWeb that TronLink injects on window. It is
//     already configured to the USER'S account and the USER'S chosen node. All
//     signing, and every read tied to the connected operator, goes through it —
//     so the user's own wallet signs, and reads travel over the user's own
//     provider. That's the non-custodial + "data stays on your machine" promise
//     made concrete at the transport layer.

export type InjectedTronWeb = InstanceType<typeof TronWeb> & {
  ready?: boolean
  defaultAddress?: { base58: string | false; hex: string | false }
}

/** The subset of the TronLink injected API we rely on. */
export interface TronLinkApi {
  ready?: boolean
  tronWeb?: InjectedTronWeb
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

declare global {
  interface Window {
    tronLink?: TronLinkApi
    tronWeb?: InjectedTronWeb
  }
}

let _readClient: TronWeb | null = null

/** Lazily-built keyless read client on the configured network. */
export function readClient(): TronWeb {
  if (!_readClient) _readClient = new TronWeb({ fullHost: NETWORK.fullHost })
  return _readClient
}

/** Structural validity — purely offline, no network, nothing leaves the device.
 *  This is the ✓'s first gate and the only check available before connect. */
export function isValidTronAddress(address: string): boolean {
  try {
    return readClient().isAddress(address)
  } catch {
    return false
  }
}

/** base58 (T...) → hex (41...), for building contract-call parameters. */
export function toHexAddress(base58: string): string {
  return readClient().address.toHex(base58)
}

/** hex (41...) → base58 (T...), for comparing on-chain log/response values back
 *  to roster addresses locally. */
export function toBase58Address(hex: string): string {
  return readClient().address.fromHex(hex)
}

/** The injected TronLink TronWeb, or null if no wallet / not ready yet. */
export function getInjectedTronWeb(): InjectedTronWeb | null {
  const tw = window.tronWeb
  if (!tw || tw.ready === false) return null
  return tw
}

/** The host the given (or injected) provider is actually talking to, e.g.
 *  "https://nile.trongrid.io". Empty string if unavailable. */
export function providerHost(tw?: InjectedTronWeb | TronWeb): string {
  const client = tw ?? getInjectedTronWeb()
  const host = (client as { fullNode?: { host?: string } } | null)?.fullNode?.host
  return host ?? ""
}

/** Is a provider host on the network we target (Nile)? Used for the
 *  wrong-network guard. */
export function isTargetNetwork(host: string): boolean {
  return host.toLowerCase().includes(NETWORK.hostMatch)
}
