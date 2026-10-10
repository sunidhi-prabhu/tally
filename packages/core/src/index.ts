// Public entry point for @tally/core: framework-independent domain logic.
// All amounts are bigint base units (AUSD: 6 decimals). Invalid input throws TallyError.

export const APP_NAME = "Tally";

export { TallyError, isTallyError, type TallyErrorCode } from "./errors";
export type {
  Expense,
  ExpenseInput,
  ExpenseSplit,
  Group,
  LedgerEntry,
  MemberId,
  NetBalance,
  ParticipantShare,
  Settlement,
  SettlementKind,
  SettlementInput,
  Transfer,
  User,
} from "./types";

export {
  AUSD_DECIMALS,
  MAX_AMOUNT,
  assertNonNegativeAmount,
  assertPositiveAmount,
  parseAmount,
  unitsFromNumber,
} from "./money";
export { formatAmount, type FormatAmountOptions } from "./format";
export {
  assertMember,
  assertUniqueParticipants,
  assertValidGroup,
  compareIds,
  isValidMemberId,
} from "./members";
export {
  assertValidExpense,
  createExpense,
  splitCustom,
  splitEqual,
} from "./split";
export {
  assertBalanced,
  assertSettlementAllowed,
  computeBalances,
  isTokenSettlement,
  ledgerEntryDeltas,
  SETTLEMENT_KINDS,
  maxSettleable,
} from "./balances";
export { simplifyDebts } from "./simplify";
export {
  MAX_DESCRIPTION_LENGTH,
  decimalAmountSchema,
  expenseInputSchema,
  expenseInputSchemaFor,
  expenseSplitSchema,
  memberIdSchema,
  participantShareSchema,
  positiveUnitsSchema,
  settlementInputSchema,
  settlementInputSchemaFor,
  settlementKindSchema,
  unitsSchema,
  type ParsedExpenseInput,
  type ParsedSettlementInput,
} from "./schemas";
