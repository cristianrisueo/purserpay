"use client"

import dynamic from "next/dynamic"

// The dashboard is client-only: it reads IndexedDB (Dexie) and the injected TronLink
// wallet at module load, neither of which exists during SSR. ssr:false reproduces the
// Vite SPA's client-only mount exactly and keeps db.ts / tron/* out of the server graph.
const Dashboard = dynamic(() => import("@/views/Dashboard"), { ssr: false })

export default function DashboardPage() {
  return <Dashboard />
}
