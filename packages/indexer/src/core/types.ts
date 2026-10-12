// GENERATED from packages/core/src/types.ts by scripts/sync-core.mjs. Do not edit here.
/**
 * Domain types. All monetary values are `bigint` amounts in the token's smallest unit
 * (AUSD: 1 AUSD = 1_000_000 units). IDs are compared exactly, so callers must normalize
 * them first (for example, lowercase EVM addresses).
 */

/** Identifies a group member, typically their account address. */
export type MemberId = string;

export interface User {
  readonly id: MemberId;
  readonly displayName: string;
}

export interface Group {
  readonly id: string;
  readonly name: string;
  /** Unique member IDs. */
  readonly members: readonly MemberId[];
}

/** One participant in an expense and the amount of it they are responsible for. */
export interface ParticipantShare {
  readonly member: MemberId;
  /** Non-negative amount in base units. */
  readonly amount: bigint;
}

export type ExpenseSplit =
  /** Divide the amount equally; see `splitEqual` for remainder handling. */
  | { readonly type: "equal"; readonly participants: readonly MemberId[] }
  /** Explicit shares that must add up to the amount exactly. */
  | { readonly type: "custom"; readonly shares: readonly ParticipantShare[] };

export interface ExpenseInput {
  readonly payer: MemberId;
  /** Positive amount in base units. */
  readonly amount: bigint;
  readonly split: ExpenseSplit;
  readonly description?: string;
}

/** A validated expense: `shares` always add up to `amount`. */
export interface Expense {
  readonly id: string;
  readonly groupId: string;
  readonly payer: MemberId;
  readonly amount: bigint;
  readonly shares: readonly ParticipantShare[];
  readonly description: string;
}

export interface SettlementInput {
  /** The member paying (a debtor). */
  readonly from: MemberId;
  /** The member being paid (a creditor). */
  readonly to: MemberId;
  /** Positive amount in base units. */
  readonly amount: bigint;
}

/**
 * How a settlement was recorded. Mirrors `SettlementKind` in TallyLedger.
 * - `"token"`: the debtor paid in AUSD on-chain in the same transaction (`settleWithToken`).
 *   The only kind that proves money moved.
 * - `"acknowledged"`: the creditor stated they were paid elsewhere (`acknowledgeSettlement`).
 *   An accounting record only; no tokens moved.
 * Both reduce balances identically.
 */
export type SettlementKind = "acknowledged" | "token";

export interface Settlement extends SettlementInput {
  readonly id: string;
  readonly groupId: string;
  readonly kind: SettlementKind;
}

/**
 * A group's history, applied in array order (oldest first).
 * `expenseUndone` reverses an earlier expense (TallyLedger `undoExpense`); it carries the
 * expense exactly as it was recorded.
 */
export type LedgerEntry =
  | { readonly kind: "expense"; readonly expense: Expense }
  | { readonly kind: "expenseUndone"; readonly expense: Expense }
  | { readonly kind: "settlement"; readonly settlement: Settlement };

/** Positive `net`: the member is owed money. Negative: the member owes money. */
export interface NetBalance {
  readonly member: MemberId;
  readonly net: bigint;
}

/** A suggested payment produced by debt simplification. */
export interface Transfer {
  readonly from: MemberId;
  readonly to: MemberId;
  /** Positive amount in base units. */
  readonly amount: bigint;
}
