import { z } from "zod";
import { isTallyError } from "./errors";
import { isValidMemberId } from "./members";
import { AUSD_DECIMALS, MAX_AMOUNT, parseAmount } from "./money";
import type { ExpenseInput, Group, SettlementInput } from "./types";

/**
 * Zod schemas for untrusted input (forms, URLs, API payloads). They check types and
 * self-contained invariants. The `...For(group)` variants also check group membership.
 *
 * These are a first line of defence for good error messages. They do not replace
 * validation in the domain functions or, later, in the smart contract.
 */

export const MAX_DESCRIPTION_LENGTH = 280;

export const memberIdSchema = z
  .string()
  .refine(isValidMemberId, "Member ID must be 1–128 characters with no spaces");

/** Base units in [0, MAX_AMOUNT]. */
export const unitsSchema = z
  .bigint()
  .refine((v) => v >= 0n, "Amount must not be negative")
  .refine((v) => v <= MAX_AMOUNT, "Amount exceeds the maximum allowed");

/** Base units in [1, MAX_AMOUNT]. */
export const positiveUnitsSchema = unitsSchema.refine(
  (v) => v > 0n,
  "Amount must be greater than zero",
);

/**
 * Human-readable decimal string (e.g. a form field) → positive base units, using
 * `parseAmount` rules: no rounding, at most `decimals` fractional digits.
 */
export function decimalAmountSchema(decimals: number = AUSD_DECIMALS) {
  return z
    .string()
    .transform((text, ctx) => {
      try {
        return parseAmount(text, decimals);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: isTallyError(error) ? error.message : "Not a valid amount",
        });
        return z.NEVER;
      }
    })
    .pipe(positiveUnitsSchema);
}

export const participantShareSchema = z.object({
  member: memberIdSchema,
  amount: unitsSchema,
});

export const expenseSplitSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("equal"),
    participants: z.array(memberIdSchema).min(1),
  }),
  z.object({
    type: z.literal("custom"),
    shares: z.array(participantShareSchema).min(1),
  }),
]);

function participantsOf(split: z.output<typeof expenseSplitSchema>): string[] {
  return split.type === "equal"
    ? split.participants
    : split.shares.map((s) => s.member);
}

export const expenseInputSchema = z
  .object({
    payer: memberIdSchema,
    amount: positiveUnitsSchema,
    split: expenseSplitSchema,
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).default(""),
  })
  .superRefine((input, ctx) => {
    const participants = participantsOf(input.split);
    const seen = new Set<string>();
    participants.forEach((member, index) => {
      if (seen.has(member)) {
        ctx.addIssue({
          code: "custom",
          message: "Participant listed more than once",
          path: [
            "split",
            input.split.type === "equal" ? "participants" : "shares",
            index,
          ],
        });
      }
      seen.add(member);
    });
    if (input.split.type === "custom") {
      const total = input.split.shares.reduce(
        (sum, share) => sum + share.amount,
        0n,
      );
      if (total !== input.amount) {
        ctx.addIssue({
          code: "custom",
          message: "Shares must add up to the expense amount",
          path: ["split", "shares"],
        });
      }
    }
  });

export const settlementInputSchema = z
  .object({
    from: memberIdSchema,
    to: memberIdSchema,
    amount: positiveUnitsSchema,
  })
  .refine((input) => input.from !== input.to, {
    message: "A member cannot pay themselves",
    path: ["to"],
  });

/** `expenseInputSchema` plus: payer and every participant belong to `group`. */
export function expenseInputSchemaFor(group: Group) {
  const members = new Set(group.members);
  return expenseInputSchema.superRefine((input, ctx) => {
    if (!members.has(input.payer)) {
      ctx.addIssue({
        code: "custom",
        message: "Payer is not a group member",
        path: ["payer"],
      });
    }
    participantsOf(input.split).forEach((member, index) => {
      if (!members.has(member)) {
        ctx.addIssue({
          code: "custom",
          message: "Participant is not a group member",
          path: [
            "split",
            input.split.type === "equal" ? "participants" : "shares",
            index,
          ],
        });
      }
    });
  });
}

export const settlementKindSchema = z.enum(["acknowledged", "token"]);

/** `settlementInputSchema` plus: both parties belong to `group`. */
export function settlementInputSchemaFor(group: Group) {
  const members = new Set(group.members);
  return settlementInputSchema.superRefine((input, ctx) => {
    if (!members.has(input.from)) {
      ctx.addIssue({
        code: "custom",
        message: "Payer is not a group member",
        path: ["from"],
      });
    }
    if (!members.has(input.to)) {
      ctx.addIssue({
        code: "custom",
        message: "Recipient is not a group member",
        path: ["to"],
      });
    }
  });
}

// Compile-time checks that parsed output is accepted by the domain functions.
type Assignable<T, U extends T> = U;
export type ParsedExpenseInput = Assignable<
  ExpenseInput,
  z.output<typeof expenseInputSchema>
>;
export type ParsedSettlementInput = Assignable<
  SettlementInput,
  z.output<typeof settlementInputSchema>
>;
