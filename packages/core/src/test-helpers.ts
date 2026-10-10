// Shared helpers for unit tests. Not exported from the package entry point.
import { expect } from "vitest";
import { isTallyError, type TallyErrorCode } from "./errors";
import { parseAmount } from "./money";
import { createExpense } from "./split";
import type { Group, LedgerEntry, MemberId, SettlementKind } from "./types";

/** Asserts that `fn` throws a TallyError with the given code. */
export function expectTallyError(
  fn: () => unknown,
  code: TallyErrorCode,
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(
    isTallyError(thrown),
    `expected TallyError ${code}, got ${String(thrown)}`,
  ).toBe(true);
  expect((thrown as { code: unknown }).code).toBe(code);
}

/** Whole or decimal AUSD → base units, e.g. ausd("12.5") === 12_500_000n. */
export const ausd = (value: string): bigint => parseAmount(value);

export function makeGroup(members: readonly MemberId[], id = "g1"): Group {
  return { id, name: "Test group", members };
}

/** Ledger entry for an equally split expense. */
export function equalExpense(
  group: Group,
  id: string,
  payer: MemberId,
  amount: bigint,
  participants: readonly MemberId[],
): LedgerEntry {
  return {
    kind: "expense",
    expense: createExpense(group, id, {
      payer,
      amount,
      split: { type: "equal", participants },
    }),
  };
}

export function settlement(
  group: Group,
  id: string,
  from: MemberId,
  to: MemberId,
  amount: bigint,
  kind: SettlementKind = "acknowledged",
): LedgerEntry {
  return {
    kind: "settlement",
    settlement: { id, groupId: group.id, from, to, amount, kind },
  };
}

/** Balances as a plain object for readable assertions. */
export function netMap(balances: readonly { member: MemberId; net: bigint }[]) {
  return Object.fromEntries(balances.map((b) => [b.member, b.net]));
}
