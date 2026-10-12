// Server side of the gas sponsor. Imported only by app/api/relay/route.ts. Holds the fee
// wallet's key (SPONSOR_PRIVATE_KEY, a server-only env var); never import this from client code.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";
import { chainFor } from "@/lib/chain";
import type { AppConfig } from "@/lib/config";
import { tallyAccountAbi } from "@/lib/contracts/tallyAccountAbi";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { checkRelayRequest, createRateLimiter } from "./policy";
import {
  BATCH_MODE,
  delegationDesignator,
  encodeExecutionData,
  type RelayResponse,
} from "./protocol";

/** anvil/hardhat dev accounts 0-9: their keys are public. Allowed only on the local chain. */
const ANVIL_DEV_ACCOUNTS = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
  "0x976ea74026e726554dB657fA54763abd0C3a0aa9".toLowerCase(),
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
  "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
]);

/** Below this the sponsor stops, rather than failing halfway through someone's action. */
const MIN_SPONSOR_BALANCE = 50_000_000_000_000_000n; // 0.05 MON
const MAX_GAS = 3_000_000n;

// Per server instance: a first line of defence, not a guarantee (see README).
const perWallet = createRateLimiter(20, 10 * 60_000);
const perClient = createRateLimiter(60, 10 * 60_000);

// One send at a time per instance, so concurrent requests don't reuse the sponsor's nonce.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export interface RelayOutcome {
  status: number;
  body: RelayResponse;
}

const fail = (
  status: number,
  error: string,
  errorName?: string,
): RelayOutcome => ({
  status,
  body: { ok: false, error, errorName },
});

/** Errors any batch can revert with, so simulation failures come back by name. */
const decodingAbi = [
  ...tallyAccountAbi,
  ...tallyLedgerAbi.filter((item) => item.type === "error"),
] as const;

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk(
    (e) => e instanceof ContractFunctionRevertedError,
  );
  return reverted instanceof ContractFunctionRevertedError
    ? reverted.data?.errorName
    : undefined;
}

export function sponsorAddress(key: string | undefined): Address | undefined {
  return key && /^0x[0-9a-fA-F]{64}$/.test(key)
    ? privateKeyToAccount(key as Hex).address
    : undefined;
}

export async function handleRelay(input: {
  config: AppConfig;
  sponsorKey: string | undefined;
  clientKey: string;
  body: unknown;
}): Promise<RelayOutcome> {
  const { config } = input;
  if (
    !config.gasless ||
    !config.smartAccountAddress ||
    !config.expectedTokenAddress
  )
    return fail(404, "Gasless transactions are not enabled.");
  const key = input.sponsorKey;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    return fail(503, "The gas sponsor is not configured.");
  const sponsor = privateKeyToAccount(key as Hex);
  if (
    config.chainId !== 31337 &&
    ANVIL_DEV_ACCOUNTS.has(sponsor.address.toLowerCase())
  )
    return fail(
      503,
      "Refusing to use a public development key as the sponsor.",
    );
  if (!perClient(input.clientKey))
    return fail(429, "Too many requests. Wait a few minutes and try again.");

  const smartAccount = config.smartAccountAddress;
  const checked = checkRelayRequest(input.body, {
    chainId: config.chainId,
    ledger: config.ledgerAddress,
    token: config.expectedTokenAddress,
    smartAccount,
    now: Math.floor(Date.now() / 1000),
  });
  if (!checked.ok) return fail(400, checked.error);
  const { wallet, calls, nonce, deadline, signature, authorization } =
    checked.request;
  if (!perWallet(wallet.toLowerCase()))
    return fail(429, "Too many actions from this wallet. Try again later.");

  const chain = chainFor(config);
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
    pollingInterval: 250,
  });
  const walletClient = createWalletClient({
    chain,
    account: sponsor,
    transport: http(config.rpcUrl),
  });

  return serialized(async () => {
    const balance = await publicClient.getBalance({ address: sponsor.address });
    if (balance < MIN_SPONSOR_BALANCE)
      return fail(503, "Tally's gas sponsor is out of funds. Try again later.");

    // 1. First use: delegate the wallet to TallyAccount, signed by the wallet itself.
    const designator = delegationDesignator(smartAccount);
    let code = (await publicClient.getCode({ address: wallet }))?.toLowerCase();
    let delegationHash: Hex | undefined;
    if (!code || code === "0x") {
      if (!authorization)
        return fail(
          400,
          "This wallet needs to be set up for gasless use first.",
        );
      const signed = {
        address: authorization.address,
        chainId: authorization.chainId,
        nonce: authorization.nonce,
        r: authorization.r,
        s: authorization.s,
        yParity: authorization.yParity,
      };
      const signer = await recoverAuthorizationAddress({
        authorization: signed,
      });
      if (getAddress(signer) !== wallet)
        return fail(400, "The delegation wasn't signed by this wallet.");
      // Monad charges the full gas limit, so estimate instead of a generous fixed limit.
      let delegationGas = 150_000n;
      try {
        const estimate = await publicClient.estimateGas({
          account: sponsor.address,
          to: wallet,
          data: "0x",
          authorizationList: [signed],
        });
        delegationGas = (estimate * 13n) / 10n;
      } catch {
        // keep the conservative fallback
      }
      delegationHash = await walletClient.sendTransaction({
        to: wallet,
        data: "0x",
        authorizationList: [signed],
        gas: delegationGas,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: delegationHash,
        timeout: 60_000,
      });
      if (receipt.status !== "success")
        return fail(
          502,
          "Setting up the wallet failed. Nothing else was sent.",
        );
      code = (await publicClient.getCode({ address: wallet }))?.toLowerCase();
    }
    if (code !== designator)
      return fail(
        409,
        "This wallet runs other smart-account code, so Tally can't sponsor it.",
      );

    // 2. Simulate exactly what will be sent; refuse anything that would revert.
    const args = [
      BATCH_MODE,
      encodeExecutionData(calls),
      nonce,
      deadline,
      signature,
    ] as const;
    try {
      await publicClient.simulateContract({
        address: wallet,
        abi: decodingAbi,
        functionName: "executeWithSignature",
        args,
        account: sponsor.address,
      });
    } catch (error) {
      const name = revertName(error);
      return fail(
        422,
        name ? `The contract rejected this: ${name}.` : "Simulation failed.",
        name,
      );
    }

    // 3. Send. The wallet's signature fixes the calls; the sponsor only pays.
    const data = encodeFunctionData({
      abi: tallyAccountAbi,
      functionName: "executeWithSignature",
      args,
    });
    const estimate = await publicClient.estimateGas({
      account: sponsor.address,
      to: wallet,
      data,
    });
    if (estimate > MAX_GAS)
      return fail(422, "This action needs more gas than Tally sponsors.");
    const hash = await walletClient.sendTransaction({
      to: wallet,
      data,
      gas: (estimate * 13n) / 10n,
    });
    return { status: 200, body: { ok: true, hash, delegationHash } };
  });
}
