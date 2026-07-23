"use client"

import { useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { DeleteDataButton } from "@/components/dashboard/DeleteDataButton"
import { EmptyRoster } from "@/components/dashboard/EmptyRoster"
import { ExchangeConfirmDialog } from "@/components/dashboard/ExchangeConfirmDialog"
import { FreeTierBanner } from "@/components/dashboard/FreeTierBanner"
import { OfacBlockedDialog } from "@/components/dashboard/OfacBlockedDialog"
import { PayoutControls } from "@/components/dashboard/PayoutControls"
import { PayoutTable } from "@/components/dashboard/PayoutTable"
import { PortalLinkButton } from "@/components/dashboard/PortalLinkButton"
import { PreflightBanner } from "@/components/dashboard/PreflightBanner"
import { ResolveConflictsDialog } from "@/components/dashboard/ResolveConflictsDialog"
import { SubscribeDialog } from "@/components/dashboard/SubscribeDialog"
import { usePayout } from "@/hooks/usePayout"
import { payoutTitle } from "@/lib/format"

export function Dashboard() {
  const payout = usePayout()
  const router = useRouter()

  const { connected, walletHydrated, disconnect } = payout

  // Route guard. Since the Free Tier, the dashboard requires only a CONNECTED
  // wallet — a non-subscriber is admitted in FREE MODE (one payee / 30 days) and
  // the fiscal form is no longer demanded to get in (it moved to the subscribe/
  // checkout flow). Guarded against the initial unknown window: wait for the
  // wallet hydrate before acting, so a genuine session is never falsely bounced.
  useEffect(() => {
    if (!walletHydrated) return
    if (!connected) router.replace("/")
  }, [connected, walletHydrated, router])

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
        creditActiveUntil={payout.referralCreditActiveUntil}
        monthsBanked={payout.referralMonthsBanked}
        freeMode={payout.freeMode}
        walletError={payout.walletError}
        onConnect={payout.connect}
        onDisconnect={handleDisconnect}
        onSubscribe={payout.openPaywall}
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
            {payout.freeMode ? (
              <div className="mb-5">
                <FreeTierBanner
                  cooldownUntil={payout.cooldownUntil}
                  onSubscribe={payout.openPaywall}
                />
              </div>
            ) : null}

            {/* NOTE (Sprint 2): the agency→agency referral card was REMOVED here — a
                paying agency inviting ANOTHER agency for a free month is dead by
                STRUCTURAL CONFLICT OF INTEREST (an agency won't arm its competitor),
                not because the incentive was too small. The off-chain credit
                infrastructure is FROZEN, not dropped (schema + claim path kept, existing
                credit still honored — see docs/08). The LIVE affiliate→agency referral
                lives in the payee portal (/portal ReferralPanel + Flex Card QR), a
                different vector on the same /r/{code} plumbing — see docs/09. */}
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
                resourceStatus={payout.resourceStatus}
                freeMode={payout.freeMode}
                batchPhase={payout.batchPhase}
                payError={payout.payError}
                rosterCount={payout.roster.length}
                onAddPayee={payout.addPayee}
                onImportRoster={payout.importRoster}
                onPayAll={payout.payAll}
                onReset={payout.reset}
                onSubscribe={payout.openPaywall}
              />
            </div>

            {/* Advisory frozen/exchange/unverified summary — shown only when the selected batch
                has something to say (zero noise on a clean batch). */}
            {payout.preflightSummary.anything ? (
              <div className="mb-3">
                <PreflightBanner summary={payout.preflightSummary} />
              </div>
            ) : null}

            <PayoutTable
              data={payout.roster}
              rowSelection={payout.rowSelection}
              onRowSelectionChange={payout.setRowSelection}
              paidIds={payout.paidIds}
              paying={payout.paying}
              connected={payout.connected}
              wrongNetwork={payout.wrongNetwork}
              freeMode={payout.freeMode}
              verifyByPayee={payout.verifyByPayee}
              rowBlocked={payout.rowBlocked}
              rowOfacFlagged={payout.rowOfacFlagged}
              rowExchange={payout.rowExchange}
              rowFrozen={payout.rowFrozen}
              rowUnverified={payout.rowUnverified}
              rowChecking={payout.rowChecking}
              rowTxState={payout.rowTxState}
              txidByPayee={payout.txidByPayee}
              payRow={payout.payRow}
              downloadReceipt={payout.downloadReceipt}
              updatePayee={payout.updatePayee}
              removePayee={payout.removePayee}
            />

            {/* Device-local data controls. The payee receipt-portal link (the fixed
                /portal URL an operator shares so payees retrieve their OWN receipts —
                see docs/09) and Download report (a PDF of every payout so far — shown
                only when there's a payout to report; survives a Reset, which only
                advances the green cycle) sit beside Delete data (a full wipe of the
                local Dexie DB, behind a confirm). Download report and Delete data act on
                device-local data only; the portal link is a public, read-only URL — the
                on-chain subscription and settled payouts are untouched by all three. */}
            <div className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                {payout.hasPayments
                  ? "A full record of every payout so far, with the time each was sent."
                  : "Your roster and payment history are stored only on this device."}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <PortalLinkButton />
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
        defaultPlan={0}
      />
      <OfacBlockedDialog
        flagged={payout.ofacFlagged}
        onDismiss={payout.dismissOfac}
      />
      {/* Accept-and-pay for exchange-looking rows — the disclaimer at decide-time. Frozen rows
          never reach here (Pay disabled + the pre-flight halts the batch first). */}
      <ExchangeConfirmDialog
        confirm={payout.exchangeConfirm}
        onConfirm={payout.confirmExchangeAndPay}
        onCancel={payout.cancelExchangeConfirm}
      />
      {/* In-app duplicate-address resolver (UX-3). Opened when a CSV import shares an address
          across rows — the uniques are already imported; the operator picks which row to keep.
          Rooted here (not inside the import dialog) so it outlives the EmptyRoster→PayoutControls
          swap that importing the uniques triggers. */}
      <ResolveConflictsDialog
        groups={payout.importConflicts}
        onResolve={payout.resolveImportConflicts}
        onCancel={payout.cancelImportConflicts}
      />
    </div>
  )
}

export default Dashboard
