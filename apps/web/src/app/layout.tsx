import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@tally/core";
import "./globals.css";
import { AppProviders } from "@/providers/AppProviders";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Split shared expenses and settle up in stablecoins on Monad.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col md:max-w-2xl px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
          <AppProviders>
            <AppShell>{children}</AppShell>
          </AppProviders>
        </div>
      </body>
    </html>
  );
}
