// GENERATED from packages/core/src/money.ts by scripts/sync-core.mjs. Do not edit here.
import { TallyError } from "./errors";

/** AUSD uses 6 decimals (verified on Monad testnet via `decimals()`). */
export const AUSD_DECIMALS = 6;

/**
 * Upper bound for any single amount (expense, share or settlement): 1 trillion AUSD,
 * i.e. 10^18 base units. It rejects typos and keeps every value well inside uint64,
 * so the future contract can store amounts compactly. The contract must enforce the same limit.
 */
export const MAX_AMOUNT = 1_000_000_000_000_000_000n;

const MAX_DECIMALS = 36;
const MAX_INPUT_LENGTH = 64;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new TallyError("INVALID_AMOUNT", `Invalid decimals: ${decimals}`);
  }
}

/**
 * Parses a human-readable decimal string into base units. Never rounds.
 *
 * Accepts digits with an optional fractional part (`"12"`, `"12.5"`, `"0.000001"`),
 * ignoring surrounding whitespace. Rejects signs, exponents, separators, empty input and
 * more fractional digits than `decimals`. Returns a value in `[0, MAX_AMOUNT]`;
 * use `assertPositiveAmount` when zero is not allowed.
 *
 * @example parseAmount("12.5") // 12_500_000n
 * @throws TallyError INVALID_AMOUNT | EXCESS_PRECISION | AMOUNT_TOO_LARGE
 */
export function parseAmount(
  input: string,
  decimals: number = AUSD_DECIMALS,
): bigint {
  assertDecimals(decimals);
  if (typeof input !== "string") {
    throw new TallyError("INVALID_AMOUNT", "Amount must be a string");
  }
  const text = input.trim();
  const match =
    text.length <= MAX_INPUT_LENGTH ? DECIMAL_PATTERN.exec(text) : null;
  if (!match) {
    throw new TallyError("INVALID_AMOUNT", "Not a valid amount", {
      input: text.slice(0, 32),
    });
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new TallyError(
      "EXCESS_PRECISION",
      `Amount has more than ${decimals} decimal places`,
      { decimals },
    );
  }
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (units > MAX_AMOUNT) {
    throw new TallyError(
      "AMOUNT_TOO_LARGE",
      "Amount exceeds the maximum allowed",
    );
  }
  return units;
}

/**
 * Converts an integer number of base units (e.g. from JSON) to bigint, refusing values
 * that a JavaScript number cannot represent exactly.
 *
 * @throws TallyError UNSAFE_INTEGER
 */
export function unitsFromNumber(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new TallyError("UNSAFE_INTEGER", `Not a safe integer: ${value}`);
  }
  return BigInt(value);
}

/**
 * Asserts `amount` is a bigint in `[0, MAX_AMOUNT]`.
 *
 * @throws TallyError INVALID_AMOUNT | NEGATIVE_AMOUNT | AMOUNT_TOO_LARGE
 */
export function assertNonNegativeAmount(
  amount: bigint,
  label = "Amount",
): void {
  if (typeof amount !== "bigint") {
    throw new TallyError(
      "INVALID_AMOUNT",
      `${label} must be a bigint in base units`,
    );
  }
  if (amount < 0n) {
    throw new TallyError("NEGATIVE_AMOUNT", `${label} must not be negative`);
  }
  if (amount > MAX_AMOUNT) {
    throw new TallyError(
      "AMOUNT_TOO_LARGE",
      `${label} exceeds the maximum allowed`,
    );
  }
}

/**
 * Asserts `amount` is a bigint in `[1, MAX_AMOUNT]`.
 *
 * @throws TallyError INVALID_AMOUNT | NON_POSITIVE_AMOUNT | AMOUNT_TOO_LARGE
 */
export function assertPositiveAmount(amount: bigint, label = "Amount"): void {
  if (typeof amount === "bigint" && amount <= 0n) {
    throw new TallyError(
      "NON_POSITIVE_AMOUNT",
      `${label} must be greater than zero`,
    );
  }
  assertNonNegativeAmount(amount, label);
}
