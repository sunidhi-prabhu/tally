import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Origins the browser may contact: this app, the configured RPC and the indexer (HTTP + WS). */
function connectSources(): string {
  const network = process.env.NEXT_PUBLIC_TALLY_NETWORK;
  const urls = [
    process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
      (network === "local-demo" ? "http://127.0.0.1:8545" : undefined),
    process.env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL ??
      (network === "local-demo"
        ? "http://localhost:8080/v1/graphql"
        : undefined),
  ].filter((u): u is string => Boolean(u));
  const origins = new Set<string>(["'self'"]);
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      origins.add(url.origin);
      origins.add(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
    } catch {
      // invalid URLs are reported by the app's config check
    }
  }
  if (isDev) origins.add("ws://localhost:*"); // Next.js dev HMR
  return [...origins].join(" ");
}

/**
 * Content Security Policy. Mera's security model treats any script injection as full key
 * compromise, so the key mitigation here is connect-src: injected code can't send data to other
 * origins. Inline scripts are still allowed because nonce-based CSP needs fully dynamic
 * rendering, which Cache Components' static shells don't use (see README, "Limitations").
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSources()}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
