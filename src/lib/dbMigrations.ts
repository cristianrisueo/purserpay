// Pure Dexie schema-migration transforms, kept OUT of db.ts so they're node-testable
// in isolation (db.ts imports dexie and touches `window`). Each is applied in place by a
// db.version(N).upgrade() to every existing stored row, preserving the user's data.

/** ROLE-1: the retired payee `role` field. Strips it from an existing stored payee,
 *  preserving id/order/name/address/amount. Mutates in place, matching Dexie's
 *  `.modify(fn)` contract. A row that never had a role is left untouched. */
export function dropRoleField(row: Record<string, unknown>): void {
  delete row.role
}
