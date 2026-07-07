// Sprint 2's demo data. As of Sprint 3A the roster itself is real, persisted
// data (see src/lib/roster.ts, src/lib/db.ts) — this array is no longer read
// by the app. Kept as a reference sample shape only. MOCK_BALANCE/MOCK_WALLET
// stay live: wallet connect + balance remain mock until Sprint 3B.

import type { Payee } from "@/lib/roster"

export const SAMPLE_ROSTER: Payee[] = [
  { id: "luna", name: "Luna", role: "model", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", amount: 2940 },
  { id: "dayshift", name: "Dayshift team", role: "chat", address: "TJmWv3kQp8xLtR2nH9sYc4dW6hZbLg7pQ2", amount: 1600 },
  { id: "nightshift", name: "Nightshift team", role: "chat", address: "TWd1KpXn7bL5mQ9rYz2vN8sJc4hW6gZ3kR", amount: 1450 },
  { id: "marco", name: "Marco", role: "editor", address: "TQ5rYz2nH9xKpM7vL3sWc8dJ6hZbN4gP2y", amount: 1800 },
  { id: "priya", name: "Priya", role: "assistant", address: "TP8xLm6cR3kQ9nH2vY7sWd4jZbG5tN8pXq", amount: 1250 },
  { id: "sofia", name: "Sofia", role: "model", address: "TS4kNq7vL9xR2mH8pY3sWc6dJbZ5gT2nKp", amount: 1100 },
  { id: "diego", name: "Diego", role: "editor", address: "TD9pXm3kR7vL2nH5sY8wQc4dJ6hZbG3tNx", amount: 900 },
]

/** Mock connected-wallet balance (USDT). Stays mock until Sprint 3B wires a
 *  real chain read. */
export const MOCK_BALANCE = 9500

export const MOCK_WALLET = {
  provider: "TronLink",
  address: "TXk9f2mQ3pR7vN8sYc4dW6hZbL5gK2LpQ7",
} as const
