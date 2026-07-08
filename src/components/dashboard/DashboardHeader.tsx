import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatUsdt, truncateAddress } from "@/lib/format"
import type { PurserError } from "@/lib/tron/errors"
import type { WalletAccount } from "@/lib/tron/wallet"

type DashboardHeaderProps = {
  connected: boolean
  wrongNetwork: boolean
  networkName: string
  account: WalletAccount | null
  balance: number | null
  walletError: PurserError | null
  onConnect: () => void
  onDisconnect: () => void
}

export function DashboardHeader({
  connected,
  wrongNetwork,
  networkName,
  account,
  balance,
  walletError,
  onConnect,
  onDisconnect,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-4 px-6 py-3.5 md:px-8">
        <Link
          href="/"
          className="text-[18px] font-bold tracking-[-0.02em] text-foreground"
        >
          Purser <span className="text-primary">Pay</span>
        </Link>

        {connected && account ? (
          <div className="flex items-center gap-2">
            {wrongNetwork ? (
              <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Wrong network — switch to {networkName}
              </span>
            ) : null}
            <div className="flex items-center gap-2 rounded-[10px] border border-border bg-card py-2 pr-2 pl-3">
              <span
                className="size-1.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="font-mono text-[12px] text-foreground">
                {account.provider}
              </span>
              <span className="hidden text-border sm:inline">·</span>
              <span className="hidden font-mono text-[12px] text-muted-foreground sm:inline">
                {truncateAddress(account.address)}
              </span>
              <span className="text-border">·</span>
              <span className="font-mono text-[12px] font-semibold text-foreground">
                {balance != null ? `${formatUsdt(balance)} USDT` : "—"}
              </span>
              <button
                type="button"
                onClick={onDisconnect}
                className="ml-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={() => onConnect()}
              className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-semibold"
            >
              Connect wallet
            </Button>
            {walletError ? (
              <span className="max-w-[240px] text-right text-[11.5px] text-destructive">
                {walletError.message}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </header>
  )
}
