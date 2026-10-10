import { AUSD_DECIMALS } from "./money";

export interface FormatAmountOptions {
  /** Token decimals. Default: AUSD_DECIMALS (6). */
  readonly decimals?: number;
  /** Pad the fraction to at least this many digits. Default: 2. */
  readonly minFractionDigits?: number;
}

/**
 * Formats base units for display. Display only: never feed the result back into calculations.
 *
 * The output is exact (no rounding): trailing zeros are trimmed down to `minFractionDigits`,
 * so 1 unit of AUSD shows as "0.000001". Negative values get a leading "-".
 *
 * @example formatAmount(12_500_000n) // "12.50"
 */
export function formatAmount(
  units: bigint,
  options: FormatAmountOptions = {},
): string {
  const decimals = options.decimals ?? AUSD_DECIMALS;
  const minFractionDigits = Math.min(options.minFractionDigits ?? 2, decimals);
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  let fraction = (abs % scale).toString().padStart(decimals, "0");
  while (fraction.length > minFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  return fraction.length > 0
    ? `${sign}${whole}.${fraction}`
    : `${sign}${whole}`;
}
