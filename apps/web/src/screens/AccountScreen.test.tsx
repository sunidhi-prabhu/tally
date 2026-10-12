import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasskeyWalletState } from "@/lib/passkey/wallet";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const wallet = {
  create: vi.fn(),
  signIn: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  signOut: vi.fn(),
};
const ctx = {
  app: {
    config: {
      mode: "local-demo",
      allowDemoAccounts: true,
      chainId: 31337,
      label: "Local demo",
    },
    chain: { nativeCurrency: { symbol: "MON" } },
    publicClient: { getBalance: vi.fn().mockResolvedValue(5n * 10n ** 18n) },
  },
  account: {
    source: "demo" as string,
    setSource: vi.fn(),
    address: undefined as string | undefined,
    demoAccounts: [] as string[],
    setAddress: vi.fn(),
    canWrite: false,
    writeBlockedReason: "Sign in with your passkey first." as
      string | undefined,
    passkey: {
      wallet: wallet as unknown,
      state: { status: "signed-out" } as PasskeyWalletState,
      unavailableReason: undefined as string | undefined,
      rpId: "localhost",
    },
    injected: {
      available: false,
      address: undefined as string | undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  },
  support: { status: "supported", prf: "yes" } as {
    status: string;
    prf?: string;
    reason?: string;
  },
};

vi.mock("@/providers/AppProviders", () => ({
  useApp: () => ctx.app,
  useAccount: () => ctx.account,
}));
vi.mock("@/lib/passkey/support", () => ({
  detectPasskeySupport: () => Promise.resolve(ctx.support),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AccountScreen } = await import("./AccountScreen");
const { WriteGate } = await import("@/components/WriteGate");

function setState(state: PasskeyWalletState) {
  ctx.account.passkey = { ...ctx.account.passkey, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx.app.config = {
    mode: "local-demo",
    allowDemoAccounts: true,
    chainId: 31337,
    label: "Local demo",
  };
  ctx.account.source = "demo";
  ctx.account.passkey = {
    wallet,
    state: { status: "signed-out" },
    unavailableReason: undefined,
    rpId: "localhost",
  };
  ctx.support = { status: "supported", prf: "yes" };
  ctx.account.injected = {
    available: false,
    address: undefined,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
});
afterEach(cleanup);

describe("passkey onboarding states", () => {
  it("offers create and sign-in when signed out, and switches to the new wallet", async () => {
    wallet.create.mockResolvedValue({
      status: "unlocked",
      address: ADDRESS,
      expiresAt: 0,
    });
    render(<AccountScreen />);
    const create = await screen.findByRole("button", {
      name: "Create passkey wallet",
    });
    expect(
      screen.getByRole("button", { name: "Sign in with an existing passkey" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name for your passkey"), {
      target: { value: "Sam's phone" },
    });
    fireEvent.click(create);
    await waitFor(() =>
      expect(wallet.create).toHaveBeenCalledWith("Sam's phone"),
    );
    await waitFor(() =>
      expect(ctx.account.setSource).toHaveBeenCalledWith("passkey"),
    );
  });

  it("does not switch identity when creation fails", async () => {
    wallet.create.mockResolvedValue({
      status: "error",
      failure: { kind: "cancelled", message: "x" },
    });
    render(<AccountScreen />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create passkey wallet" }),
    );
    await waitFor(() => expect(wallet.create).toHaveBeenCalled());
    expect(ctx.account.setSource).not.toHaveBeenCalled();
  });

  it("shows a waiting state while the browser prompt is open", async () => {
    setState({ status: "working", action: "create" });
    render(<AccountScreen />);
    expect(await screen.findByText("Waiting for your passkey…")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Create passkey wallet",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it.each([
    [
      {
        kind: "cancelled",
        message: "Passkey request cancelled or timed out. Nothing changed.",
      },
      "Cancelled",
    ],
    [
      {
        kind: "prf-unavailable",
        message: "This passkey provider can't derive a wallet key",
      },
      "That didn't work",
    ],
  ] as const)("explains failures (%o)", async (failure, title) => {
    setState({ status: "error", failure });
    render(<AccountScreen />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();
  });

  it("locked: shows the address and unlocks with the passkey", async () => {
    wallet.unlock.mockResolvedValue({
      status: "unlocked",
      address: ADDRESS,
      expiresAt: 0,
    });
    setState({ status: "locked", address: ADDRESS, reason: "idle" });
    render(<AccountScreen />);
    expect(await screen.findByTestId("passkey-address")).toBeTruthy();
    expect(screen.getByText(/Locked after inactivity/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock with passkey" }),
    );
    await waitFor(() => expect(wallet.unlock).toHaveBeenCalled());
  });

  it("unlocked: can lock and sign out (forgetting the passkey)", async () => {
    ctx.account.source = "passkey";
    setState({
      status: "unlocked",
      address: ADDRESS,
      expiresAt: Date.now() + 60_000,
    });
    render(<AccountScreen />);
    expect(await screen.findByText("Unlocked")).toBeTruthy();
    expect(screen.getByText(/5 MON for network fees/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lock now" }));
    expect(wallet.lock).toHaveBeenCalledWith("manual");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign out and forget on this device",
      }),
    );
    expect(wallet.signOut).toHaveBeenCalled();
    expect(ctx.account.setSource).toHaveBeenCalledWith("demo");
  });

  it("unsupported browsers get a reason instead of buttons", async () => {
    ctx.support = {
      status: "unsupported",
      reason: "This browser does not support passkeys (WebAuthn).",
    };
    render(<AccountScreen />);
    expect(
      await screen.findByText("This browser can't create a passkey wallet"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create passkey wallet" }),
    ).toBeNull();
  });

  it("a passkey domain mismatch is reported as unavailable", async () => {
    ctx.account.passkey = {
      ...ctx.account.passkey,
      unavailableReason: "This page is not on the passkey domain tally.app.",
    };
    render(<AccountScreen />);
    expect(await screen.findByText(/not on the passkey domain/)).toBeTruthy();
  });

  it("states the limitations plainly", async () => {
    render(<AccountScreen />);
    expect(
      await screen.findByText(
        /This is not a smart account and fees are not sponsored/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Tally can.t recover the/)).toBeTruthy();
  });

  it("demo accounts appear only in the local demo", async () => {
    const { unmount } = render(<AccountScreen />);
    expect(
      await screen.findByRole("heading", { name: "Local demo accounts" }),
    ).toBeTruthy();
    unmount();
    ctx.app.config = {
      mode: "monad-testnet",
      allowDemoAccounts: false,
      chainId: 10143,
      label: "Monad testnet",
    };
    render(<AccountScreen />);
    await screen.findByRole("heading", { name: "Passkey wallet" });
    expect(
      screen.queryByRole("heading", { name: "Local demo accounts" }),
    ).toBeNull();
  });
});

describe("browser wallet", () => {
  it("explains how to use one when none is installed", async () => {
    render(<AccountScreen />);
    expect(await screen.findByText(/Already use MetaMask, Rabby/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Connect browser wallet" }),
    ).toBeNull();
  });

  it("connects through the wallet's own prompt", async () => {
    ctx.account.injected.available = true;
    ctx.account.injected.connect = vi.fn().mockResolvedValue(undefined);
    render(<AccountScreen />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect browser wallet" }),
    );
    expect(ctx.account.injected.connect).toHaveBeenCalled();
  });

  it("shows a rejected connection instead of switching identity", async () => {
    ctx.account.injected.available = true;
    ctx.account.injected.connect = vi
      .fn()
      .mockRejectedValue(new Error("User rejected the request."));
    render(<AccountScreen />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect browser wallet" }),
    );
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(ctx.account.setSource).not.toHaveBeenCalledWith("injected");
  });

  it("once connected, can be used or disconnected", async () => {
    ctx.account.injected.available = true;
    ctx.account.injected.address = ADDRESS;
    render(<AccountScreen />);
    expect(await screen.findByTestId("injected-address")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this wallet" }));
    expect(ctx.account.setSource).toHaveBeenCalledWith("injected");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(ctx.account.injected.disconnect).toHaveBeenCalled();
  });
});

describe("WriteGate", () => {
  it("offers unlock for a locked passkey wallet", () => {
    ctx.account.source = "passkey";
    ctx.account.writeBlockedReason =
      "Your passkey wallet is locked. Unlock it to send.";
    setState({ status: "locked", address: ADDRESS, reason: "reload" });
    render(<WriteGate />);
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock with passkey" }),
    );
    expect(wallet.unlock).toHaveBeenCalled();
  });

  it("links to account settings for view-only identities", () => {
    ctx.account.source = "view";
    ctx.account.writeBlockedReason =
      "View-only. Sign in with a passkey to send.";
    render(<WriteGate />);
    expect(
      screen.getByText("View-only. Sign in with a passkey to send."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Account settings" })
        .getAttribute("href"),
    ).toBe("/account");
  });
});
