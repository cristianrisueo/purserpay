import { getInjectedTronWeb, providerHost } from "./client"
import { noWallet, PurserError, userRejected, walletLocked } from "./errors"

// The wallet layer, behind a small provider interface. TronLink is the real,
// working path today; WalletConnect is stubbed behind the SAME interface so it
// drops in later (it needs a Reown projectId + the tronwallet-adapters stack).
// Keeping both behind one shape means the hook and header never branch on which
// wallet is connected.

export type WalletProviderId = "tronlink" | "walletconnect"

export type WalletAccount = {
  providerId: WalletProviderId
  /** Display label, e.g. "TronLink". */
  provider: string
  /** base58 (T...) operator address. */
  address: string
}

export interface WalletProvider {
  readonly id: WalletProviderId
  readonly label: string
  /** Installed/usable right now (so the UI can disable an absent option). */
  isAvailable(): boolean
  /** Prompt the user; resolve with their account or throw a calm PurserError. */
  connect(): Promise<WalletAccount>
  /** Best-effort local disconnect (TronLink has no real revoke — we just
   *  forget the session). */
  disconnect(): Promise<void>
  /** The currently-authorized address, or null. */
  getAddress(): string | null
  /** Host the wallet is talking to (for the wrong-network guard). */
  getProviderHost(): string
  /** Subscribe to account/network changes; returns an unsubscribe fn. */
  onChange(cb: () => void): () => void
}

// --- TronLink ----------------------------------------------------------------

const tronLinkProvider: WalletProvider = {
  id: "tronlink",
  label: "TronLink",

  isAvailable() {
    return Boolean(window.tronLink || window.tronWeb)
  },

  async connect() {
    const tronLink = window.tronLink

    // Modern TronLink: explicit account request (this is what shows the prompt).
    if (tronLink?.request) {
      let res: { code?: number; message?: string } | undefined
      try {
        res = (await tronLink.request({ method: "tron_requestAccounts" })) as {
          code?: number
          message?: string
        }
      } catch (e) {
        // Some builds throw instead of returning a code on rejection.
        throw e instanceof PurserError ? e : userRejected()
      }
      const code = res?.code
      if (code === 4001) throw userRejected()
      // 4000 = request already queued / wallet busy; treat as locked-ish.
      if (code != null && code !== 200) throw walletLocked()
    } else if (!window.tronWeb) {
      throw noWallet()
    }

    const tw = getInjectedTronWeb()
    const address = tw?.defaultAddress?.base58
    if (!tw || !address) throw walletLocked()
    return { providerId: "tronlink", provider: "TronLink", address }
  },

  async disconnect() {
    // TronLink exposes no programmatic revoke; the dapp simply forgets.
  },

  getAddress() {
    return getInjectedTronWeb()?.defaultAddress?.base58 || null
  },

  getProviderHost() {
    return providerHost()
  },

  onChange(cb) {
    // TronLink broadcasts account/node changes as window 'message' events.
    const handler = (e: MessageEvent) => {
      const action = (
        e.data as { message?: { action?: string } } | undefined
      )?.message?.action
      if (
        action === "accountsChanged" ||
        action === "setAccount" ||
        action === "setNode" ||
        action === "connect" ||
        action === "disconnect"
      ) {
        cb()
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  },
}

// --- WalletConnect (stub, interface-ready) -----------------------------------
// Present so the UI can offer it, but inert until a projectId is supplied and
// the adapter stack is wired in a follow-up. Never silently pretends to connect.

const walletConnectProvider: WalletProvider = {
  id: "walletconnect",
  label: "WalletConnect",
  isAvailable() {
    return Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID)
  },
  async connect() {
    throw new PurserError(
      "no-wallet",
      "WalletConnect isn't enabled yet — connect with TronLink for now."
    )
  },
  async disconnect() {},
  getAddress() {
    return null
  },
  getProviderHost() {
    return ""
  },
  onChange() {
    return () => {}
  },
}

export const WALLET_PROVIDERS: WalletProvider[] = [
  tronLinkProvider,
  walletConnectProvider,
]

export function getWalletProvider(id: WalletProviderId): WalletProvider {
  const p = WALLET_PROVIDERS.find((w) => w.id === id)
  if (!p) throw new PurserError("unknown", "Unknown wallet.")
  return p
}
