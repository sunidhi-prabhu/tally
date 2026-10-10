import { formatAmount } from "@tally/core";

/** Display-only AUSD formatting from base units (never use the result for math). */
export function formatAusd(
  units: bigint,
  options: { signed?: boolean } = {},
): string {
  const abs = units < 0n ? -units : units;
  const text = formatAmount(abs);
  if (options.signed && units > 0n) return `+${text}`;
  return units < 0n ? `-${text}` : text;
}

export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function timeAgo(unixSeconds: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Compact native-token amount (wei → "0.0021 MON") for gas estimates. Display only. */
export function formatNative(wei: bigint, symbol: string): string {
  const scale = 10n ** 18n;
  const whole = wei / scale;
  const fraction = (wei % scale)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
