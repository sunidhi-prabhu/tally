// GENERATED from packages/core/src/errors.ts by scripts/sync-core.mjs. Do not edit here.
/** Machine-readable reason for a rejected input. Stable: callers may switch on it. */
export type TallyErrorCode =
  /** Not a bigint, malformed decimal string, or invalid decimals argument. */
  | "INVALID_AMOUNT"
  /** Decimal string has more fractional digits than the token supports. */
  | "EXCESS_PRECISION"
  /** Amount must be greater than zero (expenses, settlements). */
  | "NON_POSITIVE_AMOUNT"
  /** Amount must not be negative (shares). */
  | "NEGATIVE_AMOUNT"
  /** Amount exceeds MAX_AMOUNT. */
  | "AMOUNT_TOO_LARGE"
  /** A JavaScript number is not a safe integer and cannot be converted exactly. */
  | "UNSAFE_INTEGER"
  /** Member ID is empty, too long or contains whitespace. */
  | "INVALID_MEMBER_ID"
  /** Entity ID (group, expense, settlement) is empty. */
  | "INVALID_ID"
  | "EMPTY_PARTICIPANTS"
  | "DUPLICATE_PARTICIPANT"
  | "DUPLICATE_MEMBER"
  | "NOT_A_MEMBER"
  /** Custom shares do not add up to the expense amount. */
  | "SPLIT_TOTAL_MISMATCH"
  /** The same expense or settlement ID appears twice in a ledger. */
  | "DUPLICATE_ENTRY"
  /** An entry references a different group than the one being computed. */
  | "WRONG_GROUP"
  | "SELF_SETTLEMENT"
  /** Settlement would pay more than the payer owes or the recipient is owed. */
  | "SETTLEMENT_EXCEEDS_DEBT"
  /** Net balances do not sum to zero. */
  | "UNBALANCED"
  /** Settlement kind is not "acknowledged" or "token". */
  | "INVALID_SETTLEMENT_KIND";

/** The only error type thrown by @tally/core for invalid input. */
export class TallyError extends Error {
  override readonly name = "TallyError";

  constructor(
    readonly code: TallyErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

export function isTallyError(error: unknown): error is TallyError {
  return error instanceof TallyError;
}
