"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { formatAusd, shortAddress } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:opacity-90",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-background",
  ghost: "text-accent hover:bg-accent-bg",
  danger: "bg-negative text-white hover:opacity-90",
};

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:opacity-50";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`${buttonBase} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${buttonBase} ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
  "aria-labelledby"?: string;
}) {
  return (
    <Tag
      className={`rounded-2xl border border-border bg-surface p-4 ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  id,
  children,
  action,
}: {
  id?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2
        id={id}
        className="text-sm font-semibold text-muted uppercase tracking-wide"
      >
        {children}
      </h2>
      {action}
    </div>
  );
}

type Tone = "neutral" | "positive" | "negative" | "warning" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-background text-muted border border-border",
  positive: "bg-positive-bg text-positive",
  negative: "bg-negative-bg text-negative",
  warning: "bg-warning-bg text-warning",
  accent: "bg-accent-bg text-accent",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div role={role} className={`rounded-xl px-3 py-2 text-sm ${tones[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && (
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-border/60 ${className}`}
    />
  );
}

export function LoadingList({
  rows = 3,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Signed AUSD amount with colour and a text cue (not colour alone). */
export function Amount({
  units,
  signed = false,
  className = "",
}: {
  units: bigint;
  signed?: boolean;
  className?: string;
}) {
  const tone =
    !signed || units === 0n
      ? ""
      : units > 0n
        ? "text-positive"
        : "text-negative";
  return (
    <span className={`tabular whitespace-nowrap ${tone} ${className}`}>
      {formatAusd(units, { signed })}{" "}
      <span className="text-xs font-normal opacity-70">AUSD</span>
    </span>
  );
}

function hue(address: string): number {
  let h = 0;
  for (let i = 2; i < address.length; i++)
    h = (h * 31 + address.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({
  address,
  size = 32,
}: {
  address: string;
  size?: number;
}) {
  const h = hue(address.toLowerCase());
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${(h + 60) % 360} 70% 45%))`,
      }}
    />
  );
}

export function AddressLabel({
  address,
  me,
  names,
  withAvatar = true,
}: {
  address: string;
  me?: string;
  names?: Readonly<Record<string, string>>;
  withAvatar?: boolean;
}) {
  const isMe = me !== undefined && address.toLowerCase() === me.toLowerCase();
  const name = names?.[address.toLowerCase()];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {withAvatar && <Avatar address={address} size={24} />}
      <span className="truncate" title={address}>
        {isMe ? "You" : (name ?? shortAddress(address))}
      </span>
    </span>
  );
}

export function TextField({
  label,
  hideLabel = false,
  hint,
  error,
  suffix,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Keep the label for screen readers only (when the row already shows what it is). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
  suffix?: string;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : "block text-sm font-medium"}
      >
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-surface px-3 focus-within:outline-2 focus-within:outline-accent ${
          error ? "border-negative" : "border-border"
        }`}
      >
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          className="min-h-11 w-full bg-transparent text-base outline-none"
          {...input}
        />
        {suffix && <span className="pl-2 text-sm text-muted">{suffix}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

/** Modal confirmation using the native <dialog> element (focus trap and Escape built in). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,400px)] rounded-2xl border border-border bg-surface p-0 text-foreground"
    >
      {open && (
        <div className="space-y-4 p-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="space-y-2 text-sm">{children}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm} autoFocus>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
