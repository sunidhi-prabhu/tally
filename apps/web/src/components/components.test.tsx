import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExpenseRow, SettlementRow } from "@/lib/indexer/queries";
import { BalanceBreakdown } from "./BalanceBreakdown";
import { ExpenseList } from "./ExpenseList";
import { SettlementList, settlementLabel } from "./SettlementList";
import { TxStatus } from "./TxStatus";
import { Amount } from "./ui";

afterEach(cleanup);

const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const BOB = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const names = { [BOB]: "Demo 1" };
const HASH = `0x${"ab".repeat(32)}` as const;

const settlement = (overrides: Partial<SettlementRow>): SettlementRow => ({
  id: "1-0x01",
  debtor: BOB,
  creditor: ME,
  amount: 4_000_000n,
  kind: "TOKEN_TRANSFER",
  token: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  tokenTransferConfirmed: true,
  txHash: HASH,
  timestamp: Math.floor(Date.now() / 1000),
  ...overrides,
});

describe("settlement display", () => {
  it("calls only verified token transfers 'Paid in AUSD'", () => {
    render(
      <SettlementList
        me={ME}
        names={names}
        items={[
          settlement({ id: "a" }),
          settlement({
            id: "b",
            kind: "ACKNOWLEDGED",
            token: undefined,
            tokenTransferConfirmed: false,
          }),
          settlement({
            id: "c",
            token: undefined,
            tokenTransferConfirmed: false,
          }),
        ]}
      />,
    );
    const [token, ack, pending] = screen.getAllByRole("listitem");
    expect(within(token!).getByText("Paid in AUSD")).toBeTruthy();
    expect(
      within(token!).getByText("Tokens moved on-chain in this transaction."),
    ).toBeTruthy();
    expect(within(ack!).getByText("Marked as received")).toBeTruthy();
    expect(within(ack!).getByText(/No tokens moved/)).toBeTruthy();
    expect(within(ack!).queryByText("Paid in AUSD")).toBeNull();
    expect(
      within(pending!).getByText("Token payment (confirming)"),
    ).toBeTruthy();
    expect(within(pending!).queryByText("Paid in AUSD")).toBeNull();
    expect(within(token!).getByText("Demo 1")).toBeTruthy();
    expect(within(token!).getByText("You")).toBeTruthy();
  });

  it("labels map exactly to kinds", () => {
    expect(settlementLabel(settlement({})).title).toBe("Paid in AUSD");
    expect(
      settlementLabel(
        settlement({ kind: "ACKNOWLEDGED", tokenTransferConfirmed: false }),
      ).tone,
    ).toBe("warning");
  });
});

describe("expense list", () => {
  it("shows payer, amount, your share and the split", () => {
    const expense: ExpenseRow = {
      id: "1-0xaa",
      description: "Dinner",
      amount: 30_000_000n,
      splitType: "EQUAL",
      payer: BOB,
      txHash: HASH,
      timestamp: Math.floor(Date.now() / 1000),
      shares: [
        { member: BOB, amount: 10_000_000n },
        { member: ME, amount: 10_000_000n },
      ],
    };
    render(<ExpenseList items={[expense]} me={ME} names={names} />);
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("Split equally")).toBeTruthy();
    expect(screen.getByText("Your share")).toBeTruthy();
    expect(screen.getAllByText("30.00").length).toBeGreaterThan(0);
    const shares = screen.getByRole("list", { name: "Shares" });
    expect(within(shares).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("balance breakdown", () => {
  it("shows who owes and who is owed, plus suggested payments", () => {
    render(
      <BalanceBreakdown
        me={ME}
        names={names}
        members={[
          {
            address: ME,
            active: true,
            netBalance: 5_000_000n,
            totalPaid: 0n,
            totalOwedShares: 0n,
          },
          {
            address: BOB,
            active: true,
            netBalance: -5_000_000n,
            totalPaid: 0n,
            totalOwedShares: 0n,
          },
        ]}
        transfers={[{ from: BOB, to: ME, amount: 5_000_000n }]}
      />,
    );
    expect(screen.getByText("is owed")).toBeTruthy();
    expect(screen.getByText("owes")).toBeTruthy();
    expect(screen.getByText("+5.00")).toBeTruthy();
    expect(screen.getByText("-5.00")).toBeTruthy();
    const payments = screen.getByRole("list", { name: "Suggested payments" });
    expect(within(payments).getByText("pays")).toBeTruthy();
  });

  it("says when everyone is settled", () => {
    render(
      <BalanceBreakdown me={ME} names={names} members={[]} transfers={[]} />,
    );
    expect(screen.getByText("Everyone is settled up")).toBeTruthy();
  });
});

describe("transaction status", () => {
  it("never says confirmed while pending", () => {
    render(
      <TxStatus state={{ status: "pending", label: "Pay", hash: HASH }} />,
    );
    expect(screen.getByText("Pay: submitted, not confirmed yet")).toBeTruthy();
    expect(screen.queryByText(/confirmed$/)).toBeNull();
    expect(screen.getByText(/Tx 0xabababab/)).toBeTruthy();
  });

  it("shows the block once confirmed, and alerts on failure", () => {
    const { rerender } = render(
      <TxStatus
        state={{
          status: "confirmed",
          label: "Pay",
          hash: HASH,
          blockNumber: 26n,
        }}
      />,
    );
    expect(screen.getByText("Pay: confirmed")).toBeTruthy();
    expect(screen.getByText("Included in block 26.")).toBeTruthy();
    rerender(
      <TxStatus
        state={{
          status: "failed",
          label: "Pay",
          message: "You rejected the request.",
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "You rejected the request.",
    );
  });

  it("renders nothing when idle", () => {
    const { container } = render(<TxStatus state={{ status: "idle" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("Amount", () => {
  it("labels the currency and signs only when asked", () => {
    const { container, rerender } = render(<Amount units={-1n} signed />);
    expect(container.textContent).toBe("-0.000001 AUSD");
    rerender(<Amount units={12_500_000n} />);
    expect(container.textContent).toBe("12.50 AUSD");
  });
});
