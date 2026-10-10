// Pure mapping from TallyLedger events to @tally/core types (vendored in ./core), plus
// consistency checks.
// No Envio imports, so it can be unit-tested and reused. Balance changes always come from
// core's `ledgerEntryDeltas`, the same rule `computeBalances` uses.
import {
  isTallyError,
  ledgerEntryDeltas,
  maxSettleable,
  splitCustom,
  splitEqual,
  type Expense as CoreExpense,
  type LedgerEntry,
  type Settlement as CoreSettlement,
  type SettlementKind,
} from "./core";

export type SplitTypeName = "EQUAL" | "CUSTOM";
export type SettlementKindName = "ACKNOWLEDGED" | "TOKEN_TRANSFER";

/** TallyLedger.SplitType: 0 = Equal, 1 = Custom. */
export function splitTypeFromEvent(value: bigint): SplitTypeName {
  if (value === 0n) return "EQUAL";
  if (value === 1n) return "CUSTOM";
  throw new Error(`Unknown SplitType ${value}`);
}

/**
 * TallyLedger.SettlementKind: 1 = Acknowledged, 2 = TokenTransfer. 0 (None) is never emitted.
 * Throws rather than guessing, so an acknowledgement can never be shown as a token payment.
 */
export function settlementKindFromEvent(value: bigint): SettlementKind {
  if (value === 1n) return "acknowledged";
  if (value === 2n) return "token";
  throw new Error(`Unknown SettlementKind ${value}`);
}

export const settlementKindName = (kind: SettlementKind): SettlementKindName =>
  kind === "token" ? "TOKEN_TRANSFER" : "ACKNOWLEDGED";

// Entity IDs reuse contract identifiers so records map 1:1 to on-chain state.
export const groupKey = (groupId: bigint): string => groupId.toString();
export const membershipKey = (groupId: bigint, address: string): string =>
  `${groupId}-${address.toLowerCase()}`;
export const expenseKey = (groupId: bigint, expenseId: string): string =>
  `${groupId}-${expenseId.toLowerCase()}`;
export const settlementKey = (groupId: bigint, settlementId: string): string =>
  `${groupId}-${settlementId.toLowerCase()}`;
/** Unique per chain and stable across re-delivery: the event's position in the chain. */
export const activityKey = (blockNumber: number, logIndex: number): string =>
  `${blockNumber}-${logIndex}`;

export interface ExpenseEventParams {
  readonly groupId: bigint;
  readonly expenseId: string;
  readonly payer: string;
  readonly amount: bigint;
  readonly participants: readonly string[];
  readonly shares: readonly bigint[];
  readonly description: string;
}

export interface SettlementEventParams {
  readonly groupId: bigint;
  readonly settlementId: string;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  readonly kind: bigint;
}

export function toCoreExpense(params: ExpenseEventParams): CoreExpense {
  return {
    id: expenseKey(params.groupId, params.expenseId),
    groupId: groupKey(params.groupId),
    payer: params.payer.toLowerCase(),
    amount: params.amount,
    shares: params.participants.map((member, i) => ({
      member: member.toLowerCase(),
      amount: params.shares[i] ?? 0n,
    })),
    description: params.description,
  };
}

export function toCoreSettlement(
  params: SettlementEventParams,
): CoreSettlement {
  return {
    id: settlementKey(params.groupId, params.settlementId),
    groupId: groupKey(params.groupId),
    from: params.from.toLowerCase(),
    to: params.to.toLowerCase(),
    amount: params.amount,
    kind: settlementKindFromEvent(params.kind),
  };
}

/**
 * Re-checks an emitted expense against core's rules. Returns a description of the first
 * disagreement, or undefined. The contract already enforces these rules, so a non-undefined
 * result means the contract and core have diverged and should be investigated.
 */
export function checkExpense(
  params: ExpenseEventParams,
  splitType: SplitTypeName,
): string | undefined {
  if (params.participants.length !== params.shares.length) {
    return "participants and shares have different lengths";
  }
  const expense = toCoreExpense(params);
  try {
    splitCustom(expense.amount, expense.shares);
    if (splitType === "EQUAL") {
      const expected = splitEqual(
        expense.amount,
        expense.shares.map((s) => s.member),
      );
      const mismatch = expected.findIndex(
        (s, i) => s.amount !== expense.shares[i]?.amount,
      );
      if (mismatch !== -1) {
        return `equal split share ${mismatch} differs from core splitEqual`;
      }
    }
  } catch (error) {
    return isTallyError(error)
      ? `${error.code}: ${error.message}`
      : String(error);
  }
  return undefined;
}

/**
 * Re-checks a settlement against the balances indexed so far (before applying it), using core's
 * `maxSettleable`. Returns a description of the problem, or undefined.
 */
export function checkSettlement(
  settlement: CoreSettlement,
  debtorNet: bigint,
  creditorNet: bigint,
): string | undefined {
  const max = maxSettleable(
    [
      { member: settlement.from, net: debtorNet },
      { member: settlement.to, net: creditorNet },
    ],
    settlement.from,
    settlement.to,
  );
  return settlement.amount > max
    ? `settlement ${settlement.amount} exceeds core maxSettleable ${max}`
    : undefined;
}

/** Balance changes for one entry, from core. Each entry is applied exactly once. */
export function deltasFor(
  entry: LedgerEntry,
): { member: string; delta: bigint }[] {
  return ledgerEntryDeltas(entry);
}
