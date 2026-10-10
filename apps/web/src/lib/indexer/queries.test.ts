import { describe, expect, it } from "vitest";
import {
  isVerifiedTokenPayment,
  parseGroupDetail,
  parseMyMemberships,
  parseSettlements,
} from "./queries";

describe("indexer parsers", () => {
  it("converts BigInt strings without precision loss", () => {
    const rows = parseMyMemberships({
      Membership: [
        {
          active: true,
          netBalance: "-2000000000000000001",
          group: { id: "1", name: "Trip", memberCount: 4, expenseCount: 3 },
        },
      ],
    });
    expect(rows[0]?.netBalance).toBe(-2_000_000_000_000_000_001n);
  });

  it("returns null for a missing group", () => {
    expect(parseGroupDetail({ Group: [] })).toBeNull();
  });

  it("only treats confirmed TOKEN_TRANSFER settlements as verified payments", () => {
    const [token, pending, ack] = parseSettlements({
      Settlement: [
        {
          id: "1",
          debtor: "a",
          creditor: "b",
          amount: "5",
          kind: "TOKEN_TRANSFER",
          token: "0xt",
          tokenTransferConfirmed: true,
          txHash: "0x1",
          blockTimestamp: 1,
        },
        {
          id: "2",
          debtor: "a",
          creditor: "b",
          amount: "5",
          kind: "TOKEN_TRANSFER",
          token: null,
          tokenTransferConfirmed: false,
          txHash: "0x2",
          blockTimestamp: 1,
        },
        {
          id: "3",
          debtor: "a",
          creditor: "b",
          amount: "5",
          kind: "ACKNOWLEDGED",
          token: null,
          tokenTransferConfirmed: false,
          txHash: "0x3",
          blockTimestamp: 1,
        },
      ],
    });
    expect(isVerifiedTokenPayment(token!)).toBe(true);
    expect(isVerifiedTokenPayment(pending!)).toBe(false);
    expect(isVerifiedTokenPayment(ack!)).toBe(false);
    expect(ack!.token).toBeUndefined();
  });
});
