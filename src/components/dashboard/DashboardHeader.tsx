import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { formatUsdt, truncateAddress } from "@/lib/format"

type DashboardHeaderProps = {
  connected: boolean
  onConnect: () => void
  wallet: { provider: string; address: string }
  balance: number | null
}

export function DashboardHeader({
  connected,
  onConnect,
  wallet,
  balance,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-4 px-6 py-3.5 md:px-8">
        <Link
          to="/"
          className="text-[18px] font-bold tracking-[-0.02em] text-foreground"
        >
          Purser<span className="text-primary">Pay</span>
        </Link>

        {connected ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-card py-2 pr-2 pl-3">
            <span
              className="size-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            <span className="font-mono text-[12px] text-foreground">
              {wallet.provider}
            </span>
            <span className="hidden text-border sm:inline">·</span>
            <span className="hidden font-mono text-[12px] text-muted-foreground sm:inline">
              {truncateAddress(wallet.address)}
            </span>
            <span className="text-border">·</span>
            <span className="font-mono text-[12px] font-semibold text-foreground">
              {balance != null ? `${formatUsdt(balance)} USDT` : "—"}
            </span>
            <button
              type="button"
              onClick={onConnect}
              className="ml-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <Button
            onClick={onConnect}
            className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-semibold"
          >
            Connect wallet
          </Button>
        )}
      </div>
    </header>
  )
}
