import { describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { checkCall, checkRelayRequest, createRateLimiter } from "./policy";
import { encodeExecutionData, delegationDesignator } from "./protocol";

const LEDGER = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as Address;
const WALLET = "0x4444444444444444444444444444444444444444" as Address;
const ATTACKER = "0x5555555555555555555555555555555555555555" as Address;
const NOW = 1_800_000_000;
const ctx = {
  chainId: 10143,
  ledger: LEDGER,
  token: TOKEN,
  smartAccount: ACCOUNT,
  now: NOW,
};
const SIG = `0x${"ab".repeat(65)}` as Hex;

const ledgerCall = (data: Hex) => ({ to: LEDGER, data });
const settle = ledgerCall(
  encodeFunctionData({
    abi: tallyLedgerAbi,
    functionName: "settleWithToken",
    args: [1n, `0x${"01".repeat(32)}`, ATTACKER, 5n],
  }),
);
const approve = (spender: Address, to: Address = TOKEN) => ({
  to,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, 5n],
  }),
});
const request = (overrides: Record<string, unknown> = {}) => ({
  wallet: WALLET,
  calls: [approve(LEDGER), settle],
  nonce: "0",
  deadline: String(NOW + 300),
  signature: SIG,
  ...overrides,
});

describe("sponsorship policy", () => {
  it("sponsors Tally actions: AUSD approval for the ledger, then a ledger call", () => {
    const result = checkRelayRequest(request(), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.calls).toHaveLength(2);
      expect(result.request.deadline).toBe(BigInt(NOW + 300));
    }
  });

  it("sponsors every member action on the ledger", () => {
    const calls = [
      encodeFunctionData({
        abi: tallyLedgerAbi,
        functionName: "createGroup",
        args: ["Trip", []],
      }),
      encodeFunctionData({
        abi: tallyLedgerAbi,
        functionName: "joinWithInvite",
        args: [1n, "0x1234"],
      }),
      encodeFunctionData({
        abi: tallyLedgerAbi,
        functionName: "undoExpense",
        args: [1n, `0x${"02".repeat(32)}`, WALLET, 1n, [WALLET], [1n]],
      }),
    ];
    for (const data of calls)
      expect(checkCall(ledgerCall(data), ctx)).toBeUndefined();
  });

  it("refuses AUSD approvals for anyone but the ledger", () => {
    expect(checkCall(approve(ATTACKER), ctx)).toMatch(
      /only sponsored for the Tally ledger/,
    );
  });

  it("refuses moving AUSD directly", () => {
    const transfer = {
      to: TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [ATTACKER, 5n],
      }),
    };
    expect(checkCall(transfer, ctx)).toMatch(/Only AUSD approvals/);
  });

  it("sponsors minting test tokens only on the local chain", () => {
    const mint = {
      to: TOKEN,
      data: encodeFunctionData({
        abi: parseAbi(["function mint(address to, uint256 amount)"]),
        functionName: "mint",
        args: [WALLET, 5n],
      }),
    };
    expect(checkCall(mint, { ...ctx, chainId: 31337 })).toBeUndefined();
    expect(checkCall(mint, ctx)).toMatch(
      /Unrecognized AUSD call|Only AUSD approvals/,
    );
  });

  it("refuses calls to any other contract", () => {
    expect(checkCall(approve(LEDGER, ATTACKER), ctx)).toMatch(
      /Only Tally ledger and AUSD calls/,
    );
  });

  it("refuses ledger read functions and garbage calldata", () => {
    const view = ledgerCall(
      encodeFunctionData({
        abi: tallyLedgerAbi,
        functionName: "netBalance",
        args: [1n, WALLET],
      }),
    );
    expect(checkCall(view, ctx)).toMatch(/isn't sponsored/);
    expect(checkCall(ledgerCall("0xdeadbeef"), ctx)).toMatch(/Unrecognized/);
  });

  it("limits batch size", () => {
    expect(
      checkRelayRequest(request({ calls: Array(5).fill(settle) }), ctx),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/At most 4/) });
    expect(checkRelayRequest(request({ calls: [] }), ctx)).toMatchObject({
      ok: false,
    });
  });

  it("refuses expired and far-future deadlines", () => {
    expect(
      checkRelayRequest(request({ deadline: String(NOW) }), ctx),
    ).toMatchObject({ ok: false, error: "This request has expired." });
    expect(
      checkRelayRequest(request({ deadline: String(NOW + 601) }), ctx),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/too far/) });
  });

  it("refuses malformed numbers, wallets and signatures", () => {
    for (const bad of [
      { nonce: "-1" },
      { nonce: "1e3" },
      { wallet: "0x123" },
      { signature: "0x1234" },
    ]) {
      expect(checkRelayRequest(request(bad), ctx).ok).toBe(false);
    }
  });

  it("accepts only authorizations that delegate to Tally's account on this chain", () => {
    const good = {
      address: ACCOUNT,
      chainId: 10143,
      nonce: 0,
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      yParity: 1,
    };
    expect(checkRelayRequest(request({ authorization: good }), ctx).ok).toBe(
      true,
    );
    expect(
      checkRelayRequest(
        request({ authorization: { ...good, address: ATTACKER } }),
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Tally's smart account/),
    });
    // chainId 0 would make the delegation valid on every chain.
    expect(
      checkRelayRequest(
        request({ authorization: { ...good, chainId: 0 } }),
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/another chain/),
    });
  });
});

describe("protocol encoding", () => {
  it("encodes a batch as abi.encode(Execution[])", () => {
    const data = encodeExecutionData([{ to: LEDGER, data: "0x1234" }]);
    // offset 0x20, length 1, then the tuple
    expect(data.slice(0, 2 + 64 * 2)).toBe(
      `0x${"0".repeat(62)}20${"0".repeat(63)}1`,
    );
  });

  it("builds the EIP-7702 delegation designator", () => {
    expect(delegationDesignator(ACCOUNT)).toBe(`0xef0100${"33".repeat(20)}`);
  });
});

describe("rate limiter", () => {
  it("allows `limit` hits per window, then refuses until it resets", () => {
    const allow = createRateLimiter(2, 1_000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 10)).toBe(true);
    expect(allow("a", 20)).toBe(false);
    expect(allow("b", 20)).toBe(true);
    expect(allow("a", 1_001)).toBe(true);
  });
});
