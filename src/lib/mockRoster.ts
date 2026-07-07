// Sprint 2 mock roster — the ONLY source of data this sprint. No web3, no
// persistence, no CSV parse. Amounts are numbers so the balance-aware math is
// real; `check` is a single static field standing in for the Sprint 3B on-chain
// double-check (✓ = valid on TRON, ✓✓ = also paid before) — a mock field, not logic.

export type DoubleCheck = "single" | "double"

export type Payee = {
  id: string
  name: string
  role: string
  /** Full TRON (TRC20) address — displayed truncated, full value on hover. */
  address: string
  /** USDT amount owed this cycle. */
  amount: number
  check: DoubleCheck
}

export const mockRoster: Payee[] = [
  { id: "luna", name: "Luna", role: "model", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", amount: 2940, check: "double" },
  { id: "dayshift", name: "Dayshift team", role: "chat", address: "TJmWv3kQp8xLtR2nH9sYc4dW6hZbLg7pQ2", amount: 1600, check: "double" },
  { id: "nightshift", name: "Nightshift team", role: "chat", address: "TWd1KpXn7bL5mQ9rYz2vN8sJc4hW6gZ3kR", amount: 1450, check: "double" },
  { id: "marco", name: "Marco", role: "editor", address: "TQ5rYz2nH9xKpM7vL3sWc8dJ6hZbN4gP2y", amount: 1800, check: "double" },
  { id: "priya", name: "Priya", role: "assistant", address: "TP8xLm6cR3kQ9nH2vY7sWd4jZbG5tN8pXq", amount: 1250, check: "single" },
  { id: "sofia", name: "Sofia", role: "model", address: "TS4kNq7vL9xR2mH8pY3sWc6dJbZ5gT2nKp", amount: 1100, check: "double" },
  { id: "diego", name: "Diego", role: "editor", address: "TD9pXm3kR7vL2nH5sY8wQc4dJ6hZbG3tNx", amount: 900, check: "single" },
]

/** Mock connected-wallet balance (USDT). Roster sum is 11,040 → short by 1,540
 *  with everyone checked, so the balance-aware lock is demonstrable on load. */
export const MOCK_BALANCE = 9500

export const MOCK_WALLET = {
  provider: "TronLink",
  address: "TXk9f2mQ3pR7vN8sYc4dW6hZbL5gK2LpQ7",
} as const
