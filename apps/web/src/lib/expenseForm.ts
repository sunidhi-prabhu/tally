import {
  MAX_DESCRIPTION_LENGTH,
  formatAmount,
  isTallyError,
  parseAmount,
  splitCustom,
  splitEqual,
  type ParticipantShare,
} from "@tally/core";

export type SplitMode = "equal" | "custom";

export interface ExpenseFormInput {
  description: string;
  amountText: string;
  splitMode: SplitMode;
  /** Selected participants (equal split). */
  participants: readonly string[];
  /** Custom amounts as typed, keyed by member address. Blank means 0. */
  customAmounts: Readonly<Record<string, string>>;
  /** Current group members; every participant must be one of them. */
  members: readonly string[];
}

export interface ExpensePayload {
  description: string;
  amount: bigint;
  splitMode: SplitMode;
  /** Sorted ascending, as the contract requires. */
  participants: `0x${string}`[];
  /** Parallel to participants. For equal splits this is the preview the contract will compute. */
  shares: bigint[];
}

export type FieldErrors = Partial<
  Record<"description" | "amount" | "split" | string, string>
>;

export type ExpenseFormResult =
  | { ok: true; payload: ExpensePayload; preview: ParticipantShare[] }
  | { ok: false; errors: FieldErrors; preview: ParticipantShare[] };

const message = (error: unknown) =>
  isTallyError(error)
    ? ({
        EXCESS_PRECISION: "Use at most 6 decimal places.",
        INVALID_AMOUNT: "Enter an amount like 12.50.",
        AMOUNT_TOO_LARGE: "That amount is too large.",
        NON_POSITIVE_AMOUNT: "Amount must be greater than zero.",
        NEGATIVE_AMOUNT: "Amounts cannot be negative.",
      }[error.code as string] ?? error.message)
    : "Invalid amount.";

/**
 * Validates the expense form with @tally/core and builds the contract call. No floating point:
 * amounts are parsed to bigint base units and splits come from core's splitEqual/splitCustom.
 */
export function buildExpense(input: ExpenseFormInput): ExpenseFormResult {
  const errors: FieldErrors = {};
  const description = input.description.trim();
  if (description.length === 0) errors.description = "Add a short description.";
  else if (
    new TextEncoder().encode(description).length > MAX_DESCRIPTION_LENGTH
  ) {
    errors.description = `Keep it under ${MAX_DESCRIPTION_LENGTH} bytes.`;
  }

  let amount: bigint | undefined;
  try {
    amount = parseAmount(input.amountText);
    if (amount === 0n) {
      errors.amount = "Amount must be greater than zero.";
      amount = undefined;
    }
  } catch (error) {
    errors.amount =
      input.amountText.trim() === "" ? "Enter an amount." : message(error);
  }

  const members = new Set(input.members.map((m) => m.toLowerCase()));
  let preview: ParticipantShare[] = [];
  let participants: string[] = [];
  let shares: bigint[] = [];

  if (input.splitMode === "equal") {
    participants = [
      ...new Set(input.participants.map((p) => p.toLowerCase())),
    ].sort();
    if (participants.length === 0) errors.split = "Choose at least one person.";
    else if (participants.some((p) => !members.has(p))) {
      errors.split = "Everyone in the split must be a current member.";
    } else if (amount !== undefined) {
      preview = splitEqual(amount, participants);
      shares = preview.map((s) => s.amount);
    }
  } else {
    const entries: { member: string; amount: bigint }[] = [];
    for (const [member, text] of Object.entries(input.customAmounts)) {
      if (text.trim() === "") continue;
      try {
        const value = parseAmount(text);
        if (value > 0n)
          entries.push({ member: member.toLowerCase(), amount: value });
      } catch (error) {
        errors[`share:${member.toLowerCase()}`] = message(error);
      }
    }
    entries.sort((a, b) => (a.member < b.member ? -1 : 1));
    preview = entries;
    if (entries.length === 0) errors.split = "Enter at least one share.";
    else if (entries.some((e) => !members.has(e.member))) {
      errors.split = "Everyone in the split must be a current member.";
    } else if (amount !== undefined) {
      const total = entries.reduce((sum, e) => sum + e.amount, 0n);
      if (total !== amount) {
        errors.split =
          total < amount
            ? "Shares add up to less than the amount."
            : "Shares add up to more than the amount.";
      } else {
        try {
          splitCustom(amount, entries);
          participants = entries.map((e) => e.member);
          shares = entries.map((e) => e.amount);
        } catch (error) {
          errors.split = message(error);
        }
      }
    }
  }

  if (Object.keys(errors).length > 0 || amount === undefined) {
    return { ok: false, errors, preview };
  }
  return {
    ok: true,
    preview,
    payload: {
      description,
      amount,
      splitMode: input.splitMode,
      participants: participants as `0x${string}`[],
      shares,
    },
  };
}

/** For custom splits: how much is still unassigned (negative when over-assigned). */
export function remainingToAssign(
  amountText: string,
  customAmounts: Readonly<Record<string, string>>,
): bigint | undefined {
  let amount: bigint;
  try {
    amount = parseAmount(amountText);
  } catch {
    return undefined;
  }
  let total = 0n;
  for (const text of Object.values(customAmounts)) {
    if (text.trim() === "") continue;
    try {
      total += parseAmount(text);
    } catch {
      return undefined;
    }
  }
  return amount - total;
}

/** Initial form values. */
export type ExpenseFormDraft = Pick<
  ExpenseFormInput,
  "description" | "amountText" | "splitMode" | "participants" | "customAmounts"
>;

/**
 * Form values for a corrected copy of an (undone) expense: same description, amount and split.
 * Participants who are no longer members are dropped; a custom split then no longer adds up,
 * which the form reports before anything can be sent.
 */
export function draftFromExpense(
  expense: {
    description: string;
    amount: bigint;
    splitType: "EQUAL" | "CUSTOM";
    shares: readonly { member: string; amount: bigint }[];
  },
  members: readonly string[],
): ExpenseFormDraft {
  const current = new Set(members);
  const kept = expense.shares.filter((s) => current.has(s.member));
  const exact = (units: bigint) =>
    formatAmount(units, { minFractionDigits: 0 });
  return {
    description: expense.description,
    amountText: exact(expense.amount),
    splitMode: expense.splitType === "EQUAL" ? "equal" : "custom",
    participants: kept.map((s) => s.member),
    customAmounts:
      expense.splitType === "EQUAL"
        ? {}
        : Object.fromEntries(kept.map((s) => [s.member, exact(s.amount)])),
  };
}
