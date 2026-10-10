/** Minimal JSON-RPC client (read-only methods are all the tooling needs). */
export function createRpc(url, { timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  let id = 0;
  return async function rpc(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Decodes an ABI-encoded `string` return value. */
export function decodeAbiString(hex) {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length < 128) throw new Error("not an ABI string");
  const offset = parseInt(data.slice(0, 64), 16) * 2;
  const length = parseInt(data.slice(offset, offset + 64), 16);
  return Buffer.from(
    data.slice(offset + 64, offset + 64 + length * 2),
    "hex",
  ).toString("utf8");
}

export const SELECTORS = Object.freeze({
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  settlementToken: "0x7b9e618d",
});
