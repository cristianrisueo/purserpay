"use client"

import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { EmptyRoster } from "@/components/dashboard/EmptyRoster"
import { PayoutControls } from "@/components/dashboard/PayoutControls"
import { PayoutTable } from "@/components/dashboard/PayoutTable"
import { usePayout } from "@/hooks/usePayout"

export function Dashboard() {
  const payout = usePayout()

  return (
    <div className="min-h-svh bg-background">
      <DashboardHeader
        connected={payout.connected}
        wrongNetwork={payout.wrongNetwork}
        networkName={payout.networkName}
        account={payout.account}
        balance={payout.balance}
        walletError={payout.walletError}
        onConnect={payout.connect}
        onDisconnect={payout.disconnect}
      />

      <main className="mx-auto w-full max-w-[1160px] px-6 py-8 md:px-8 md:py-12">
        <div className="mb-6 md:mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-foreground md:text-[28px]">
            March payout
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
              updatePayee={payout.updatePayee}
              removePayee={payout.removePayee}
            />
          </>
        )}
      </main>
    </div>
  )
}

export default Dashboard
