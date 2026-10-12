"use client";

import { useEffect, useState } from "react";

/**
 * A scannable QR code for `value`, rendered as an <img> from a data URL (CSP allows `data:`
 * images), so no generated markup is injected into the page.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<{ value: string; url: string } | undefined>();

  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then((qr) =>
        qr.toDataURL(value, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 512,
          color: { dark: "#000000", light: "#ffffff" },
        }),
      )
      .then((url) => !cancelled && setSrc({ value, url }))
      .catch(() => !cancelled && setSrc(undefined));
    return () => {
      cancelled = true;
    };
  }, [value]);

  const url = src?.value === value ? src.url : undefined;
  return (
    <div className="flex justify-center">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL; next/image has nothing to optimize
        <img
          src={url}
          alt={label}
          width={192}
          height={192}
          className="rounded-xl border border-border bg-white p-2"
        />
      ) : (
        <div
          className="h-48 w-48 animate-pulse rounded-xl border border-border bg-background"
          aria-hidden
        />
      )}
    </div>
  );
}
