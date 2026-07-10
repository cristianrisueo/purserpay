"use client"

import { useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DeleteDataButton } from "@/components/dashboard/DeleteDataButton"
import { EmptyRoster } from "@/components/dashboard/EmptyRoster"
import { OfacBlockedDialog } from "@/components/dashboard/OfacBlockedDialog"
import { PayoutControls } from "@/components/dashboard/PayoutControls"
import { PayoutTable } from "@/components/dashboard/PayoutTable"
import { SubscribeDialog } from "@/components/dashboard/SubscribeDialog"
import { usePayout } from "@/hooks/usePayout"
import { payoutTitle } from "@/lib/format"

export function Dashboard() {
  const payout = usePayout()
  const router = useRouter()

  const {
    connected,
    walletHydrated,
    subscriptionActive,
    subscriptionChecking,
    disconnect,
  } = payout

  // Route guard (production, fail-closed). The contract is deployed, so the
  // dashboard strictly requires a connected wallet AND an active on-chain
  // subscription — anyone else is redirected to the landing. No dev bypass.
  // Guarded against the initial unknown window: wait for the wallet hydrate, and
  // for the subscription read to settle, before acting, so a genuine session is
  // never falsely bounced during load.
  useEffect(() => {
    if (!walletHydrated) return
    if (!connected) {
      router.replace("/")
      return
    }
    if (subscriptionChecking || subscriptionActive === null) return
    if (subscriptionActive === false) router.replace("/")
  }, [
    connected,
    walletHydrated,
    subscriptionActive,
    subscriptionChecking,
    router,
  ])

  // Disconnect the wallet AND leave the gated dashboard immediately.
  const handleDisconnect = useCallback(async () => {
    await disconnect()
    router.replace("/")
  }, [disconnect, router])

  return (
    <div className="min-h-svh bg-background">
      <DashboardHeader
        connected={payout.connected}
        wrongNetwork={payout.wrongNetwork}
        networkName={payout.networkName}
        account={payout.account}
        balance={payout.balance}
        subscriptionExpiresAt={payout.subscriptionExpiresAt}
        walletError={payout.walletError}
        onConnect={payout.connect}
        onDisconnect={handleDisconnect}
      />

      <main className="mx-auto w-full max-w-[1160px] px-6 py-8 md:px-8 md:py-12">
        <div className="mb-6 md:mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-foreground md:text-[28px]">
            {payoutTitle()}
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
            Everyone's checked by default. Uncheck anyone you're skipping this
            month — they stay in the table for next time. Nothing is signed until
            you review and pay.
          </p>
        </div>

        {payout.isLoading ? (
          <div className="rounded-[14px] border border-border bg-card px-6 py-16 text-center text-[14px] text-muted-foreground">
            Loading your roster…
          </div>
        ) : payout.isEmpty ? (
          <EmptyRoster
            rosterCount={payout.roster.length}
            onAddPayee={payout.addPayee}
            onImportRoster={payout.importRoster}
          />
        ) : (
          <>
            <div className="mb-5">
              <PayoutControls
                connected={payout.connected}
                wrongNetwork={payout.wrongNetwork}
                networkName={payout.networkName}
                selectedCount={payout.selectedCount}
                selectedSum={payout.selectedSum}
                outstandingCount={payout.outstandingCount}
                blockedCount={payout.blockedCount}
                shortfall={payout.shortfall}
                allSelectedPaid={payout.allSelectedPaid}
                anyPaid={payout.anyPaid}
                paying={payout.paying}
                verifying={payout.verifying}
                canPayAll={payout.canPayAll}
                batchPhase={payout.batchPhase}
                payError={payout.payError}
                rosterCount={payout.roster.length}
                onAddPayee={payout.addPayee}
                onImportRoster={payout.importRoster}
                onPayAll={payout.payAll}
                onReset={payout.reset}
              />
            </div>

            <PayoutTable
              data={payout.roster}
              rowSelection={payout.rowSelection}
              onRowSelectionChange={payout.setRowSelection}
              paidIds={payout.paidIds}
              paying={payout.paying}
              connected={payout.connected}
              wrongNetwork={payout.wrongNetwork}
              verifyByPayee={payout.verifyByPayee}
              rowBlocked={payout.rowBlocked}
              rowTxState={payout.rowTxState}
              txidByPayee={payout.txidByPayee}
              payRow={payout.payRow}
              downloadReceipt={payout.downloadReceipt}
              updatePayee={payout.updatePayee}
              removePayee={payout.removePayee}
            />

            {/* Device-local data controls. Download report (a PDF of every payout
                so far — shown only when there's a payout to report; survives a Reset,
                which only advances the green cycle) sits beside Delete data (a full
                wipe of the local Dexie DB, behind a confirm). Both act on device-local
                data only — the on-chain subscription and settled payouts are untouched. */}
            <div className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                {payout.hasPayments
                  ? "A full record of every payout so far, with the time each was sent."
                  : "Your roster and payment history are stored only on this device."}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                {payout.hasPayments ? (
                  <Button
                    variant="outline"
                    onClick={payout.downloadReport}
                    className="h-auto rounded-[10px] px-4 py-2.5 text-[14px] font-medium"
                  >
                    Download report
                  </Button>
                ) : null}
                <DeleteDataButton onDelete={payout.deleteAllData} />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Compliance gates — the paywall and the OFAC block. Both are driven by
          usePayout state and only ever open from the payout flow. */}
      <SubscribeDialog
        open={payout.paywallOpen}
        onOpenChange={payout.setPaywallOpen}
        onSubscribe={payout.subscribe}
        phase={payout.subscribePhase}
        error={payout.subscribeError}
        networkName={payout.networkName}
      />
      <OfacBlockedDialog
        flagged={payout.ofacFlagged}
        onDismiss={payout.dismissOfac}
      />
    </div>
  )
}

export default Dashboard
