// Browser side of gasless transactions for passkey wallets: build the batch, simulate it
// before asking for the passkey, sign it, and hand it to Tally's sponsor (/api/relay).
import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type LocalAccount,
  type PublicClient,
} from "viem";
import type { AppConfig } from "@/lib/config";
import { tallyAccountAbi } from "@/lib/contracts/tallyAccountAbi";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { describeContractError } from "@/lib/errors";
import {
  BATCH_MODE,
  EXECUTE_TYPES,
  MAX_DEADLINE_SECONDS,
  delegationDesignator,
  encodeExecutionData,
  executeDomain,
  type RelayCall,
  type RelayRequest,
  type RelayResponse,
} from "./protocol";

/** A contract call described as data (same shape as useTransaction's ContractCall). */
export interface SponsoredCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

const decodingAbi = [
  ...tallyAccountAbi,
  ...tallyLedgerAbi.filter((item) => item.type === "error"),
] as const;

export class SponsorError extends Error {
  override readonly name = "SponsorError";
}

export interface SponsoredSend {
  /** Simulates; throws a readable error before any passkey prompt if the batch would fail. */
  prepare: () => Promise<void>;
  /** Signs with the passkey wallet and submits through the sponsor. */
  send: () => Promise<Hash>;
}

export function sponsoredSend(input: {
  config: AppConfig;
  publicClient: PublicClient;
  account: LocalAccount;
  calls: readonly SponsoredCall[];
  fetchImpl?: typeof fetch;
}): SponsoredSend {
  const { config, publicClient, account } = input;
  const smartAccount = config.smartAccountAddress;
  if (!smartAccount) throw new SponsorError("Gasless transactions are off.");
  const wallet = account.address;
  const relayCalls: RelayCall[] = input.calls.map((c) => ({
    to: c.address,
    data: encodeFunctionData({
      abi: c.abi as Abi,
      functionName: c.functionName,
      args: c.args ?? [],
    }),
  }));
  const executionData = encodeExecutionData(relayCalls);
  const designator = delegationDesignator(smartAccount);
  let delegated: boolean | undefined;

  async function isDelegated(): Promise<boolean> {
    const code = (
      await publicClient.getCode({ address: wallet })
    )?.toLowerCase();
    if (code && code !== "0x" && code !== designator)
      throw new SponsorError(
        "This wallet runs other smart-account code, so Tally can't sponsor it.",
      );
    return code === designator;
  }

  return {
    async prepare() {
      delegated = await isDelegated();
      // The wallet calling itself is exactly what executeWithSignature does after checking
      // the signature. Before the first use, simulate as if it were already delegated.
      const stateOverride = delegated
        ? undefined
        : [
            {
              address: wallet,
              code: await publicClient.getCode({ address: smartAccount }),
            },
          ];
      try {
        await publicClient.simulateContract({
          address: wallet,
          abi: decodingAbi,
          functionName: "execute",
          args: [BATCH_MODE, executionData],
          account: wallet,
          stateOverride,
        });
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },

    async send() {
      if (delegated === undefined) delegated = await isDelegated();
      const nonce = delegated
        ? await publicClient.readContract({
            address: wallet,
            abi: tallyAccountAbi,
            functionName: "nonce",
          })
        : 0n;
      const deadline = BigInt(
        Math.floor(Date.now() / 1000) + MAX_DEADLINE_SECONDS - 60,
      );
      const signature = await account.signTypedData({
        domain: executeDomain(config.chainId, wallet),
        types: EXECUTE_TYPES,
        primaryType: "Execute",
        message: { mode: BATCH_MODE, executionData, nonce, deadline },
      });
      const body: RelayRequest = {
        wallet,
        calls: relayCalls,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature,
      };
      if (!delegated) {
        if (!account.signAuthorization)
          throw new SponsorError("This wallet can't set up gasless use.");
        const authorization = await account.signAuthorization({
          contractAddress: smartAccount,
          chainId: config.chainId,
          nonce: await publicClient.getTransactionCount({ address: wallet }),
        });
        body.authorization = {
          address: smartAccount,
          chainId: config.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity ?? (authorization.v === 28n ? 1 : 0),
        };
      }
      const response = await (input.fetchImpl ?? fetch)("/api/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let result: RelayResponse;
      try {
        result = (await response.json()) as RelayResponse;
      } catch {
        throw new SponsorError(
          "Tally's gas sponsor didn't respond. Try again.",
        );
      }
      if (!result.ok)
        throw new SponsorError(
          result.errorName
            ? describeContractError(result.errorName)
            : result.error,
        );
      return result.hash;
    },
  };
}
