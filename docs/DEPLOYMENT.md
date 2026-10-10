# Deploying Tally to Monad testnet

**Status: ready for a human-approved deployment. Nothing has been deployed to any public
network.** `packages/contracts/deployments/monad-testnet.json` says `not-deployed` and holds no
address, transaction or block. Live testnet integration has **not** been verified.

## What was verified (2026-10-10, read-only)

| Fact                                | Value                                                                                                                                                                                                    | How                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Monad testnet chain ID              | `10143` (mainnet is `143`)                                                                                                                                                                               | `eth_chainId` on `https://testnet-rpc.monad.xyz`                                             |
| Testnet AUSD                        | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, symbol `AUSD`, 6 decimals, EIP-1967 proxy                                                                                                                  | [Agora deployments](https://docs.agora.finance/developer/contract-deployments) + `cast call` |
| Mainnet AUSD                        | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` has **no code on testnet**                                                                                                                                  | `cast code`                                                                                  |
| Agora AUSD faucet (testnet)         | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`, `requestFunds(address)`, 10,000 AUSD per drip, holder cap 100,000 AUSD, `maxDripFrequency` 60 s (a single `lastDripTimestamp`, so it appears to be global) | verified ABI on Monadscan + getters read on-chain                                            |
| Deploy script on live testnet state | simulation succeeds; gas ≈ 3.07 M, max cost ≈ 0.41 MON at 102 gwei                                                                                                                                       | `deploy:testnet:preflight` (no broadcast)                                                    |
| Full pipeline                       | broadcast + record verified on a **local fork** of testnet (bytecode matches build)                                                                                                                      | `--rehearsal` (no public transaction)                                                        |

## Environments are separate

| Environment   | Chain               | Where configured                                                                                         | Can it reach a public network?                                                     |
| ------------- | ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Local demo    | anvil 31337         | `LocalDemo.s.sol`, `packages/indexer/config.yaml`, `NEXT_PUBLIC_TALLY_NETWORK=local-demo`                | No. The web app refuses non-local RPCs in this mode.                               |
| Rehearsal     | local fork of 10143 | `--rehearsal`, RPC must be 127.0.0.1/localhost                                                           | No. Outputs go to git-ignored `broadcast-rehearsal/` and `deployments/rehearsal/`. |
| Monad testnet | 10143               | `DeployTallyLedgerTestnet.s.sol`, `config.monad-testnet.yaml`, `NEXT_PUBLIC_TALLY_NETWORK=monad-testnet` | Only via the guarded `broadcast` command.                                          |
| Monad mainnet | 143                 | **Not configured anywhere**                                                                              | No.                                                                                |

Testnet tooling can't silently hit mainnet. It checks for mainnet in four separate places:

- `eth_chainId` must be 10143; 143 is rejected by name.
- Known mainnet RPC hostnames are rejected.
- The deploy script itself reverts on any other `block.chainid`.
- Mainnet AUSD is rejected as a token.

## Prerequisites

- **Tools:** Foundry ≥ 1.8.0 (tested on 1.8.5), Node ≥ 22.15, pnpm 12.6.0.
- **A deployer account you control, with a fresh key.** Never use an anvil dev account; the tooling rejects all ten. Use either:
  - **A Foundry keystore (encrypted):**
    ```bash
    cast wallet import tally-deployer --interactive   # prompts for the key; not stored in shell history
    cast wallet address --account tally-deployer       # → DEPLOYER_ADDRESS
    ```
  - **Or a Ledger:** set `DEPLOYER_LEDGER=true`.
- **MON for gas:** at least the preflight's "needs at least" figure, currently about 0.5 MON. Get it from [faucet.monad.xyz](https://faucet.monad.xyz). Monad charges for the full gas limit, not gas used.
- **Test AUSD for users** (after deployment): Agora's faucet, `requestFunds(address)`, sends 10,000 AUSD per call. This is a public transaction, so you send it yourself, e.g. from the app's user wallet.
- **For live indexing:** an Envio account and an `ENVIO_API_TOKEN` (HyperSync).
- **For the web app:** the production domain, for passkeys.

## Configuration

`packages/contracts/.env` (see `.env.example`; never commit it):

```bash
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_ACCOUNT=tally-deployer          # or DEPLOYER_LEDGER=true
DEPLOYER_ADDRESS=0x…                      # public address of that keystore/Ledger
AUSD_ADDRESS=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
TALLY_CONFIRM_DEPLOY=                     # leave empty until the review below
```

The tooling refuses to run if `PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` or `MNEMONIC` is set.

## Steps

### 1. Preflight (safe, repeatable, never broadcasts)

```bash
cd packages/contracts
pnpm deploy:testnet:preflight
```

The preflight checks, each reported as PASS or FAIL:

- configuration and signer (the keystore exists; it is opened only by forge)
- compiler settings identical to what was tested: solc 0.8.37, evm osaka, optimizer off, `monad:MonadNine`
- chain is 10143 and the RPC is reachable
- the AUSD address, its bytecode and its metadata
- a cost estimate, and the deployer's balance against it
- a **forge simulation** of the deploy script against live testnet state

Any FAIL means stop.

### 2. Optional rehearsal on a local fork (no public transaction)

```bash
anvil --fork-url https://testnet-rpc.monad.xyz --network monad --port 8546
# in another terminal, impersonate and fund the deployer on the FORK only:
cast rpc anvil_impersonateAccount $DEPLOYER_ADDRESS --rpc-url http://127.0.0.1:8546
cast rpc anvil_setBalance $DEPLOYER_ADDRESS 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8546
MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 pnpm deploy:testnet:broadcast --rehearsal
MONAD_TESTNET_RPC_URL=http://127.0.0.1:8546 pnpm deploy:testnet:record --rehearsal
```

### 3. Human review (stop here until approved)

Review the preflight output with whoever approves the deployment. Check that:

- the deployer address is right
- the cost and balance are acceptable
- the token is testnet AUSD
- the chain is 10143

Then, and only then, set `TALLY_CONFIRM_DEPLOY=monad-testnet:10143`.

### 4. Broadcast (sends ONE public transaction)

```bash
pnpm deploy:testnet:broadcast
```

The command:

1. reruns the full preflight
2. requires `TALLY_CONFIRM_DEPLOY`
3. requires an interactive terminal where you type `deploy 10143`
4. runs `forge script … --broadcast --slow --account <keystore>` (or `--ledger`); forge asks for the keystore password

The script re-checks the chain, token and sender before sending, and checks the deployed contract's configuration afterwards.

### 5. Record (only verified values)

```bash
pnpm deploy:testnet:record
```

It reads forge's broadcast record, then fetches the receipt and on-chain state. It writes `deployments/monad-testnet.json` only if all of these hold:

- the receipt succeeded on chain 10143
- the address matches the broadcast record
- `settlementToken()` is testnet AUSD
- the runtime bytecode matches the local build

Commit the manifest and `broadcast/DeployTallyLedgerTestnet.s.sol/10143/run-latest.json` (neither contains secrets).

### 6. Verify the source on the explorer

```bash
forge verify-contract <address> src/TallyLedger.sol:TallyLedger --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC)
```

This is the Sourcify verifier from [Monad's guide](https://docs.monad.xyz/guides/verify-smart-contract/foundry); no API key is needed. Monadscan needs `--verifier etherscan --etherscan-api-key`. Then check the address on [testnet.monadscan.com](https://testnet.monadscan.com) and [testnet.monadvision.com](https://testnet.monadvision.com).

### 7. Indexer

**Hosting decision: Envio Cloud (hosted HyperIndex). Self-hosting is the fallback.**

Envio Cloud builds only the configured Indexer Directory. Its docs say imports must stay inside that directory, and `workspace:*` dependencies don't resolve there. To work within that, `packages/indexer` is self-contained:

- **Vendored core.** `src/core/` holds generated, byte-identical copies of the six dependency-free `@tally/core` modules the indexer uses: `errors`, `types`, `money`, `members`, `split` and `balances`. That includes `ledgerEntryDeltas`, the single accounting rule. Edit `packages/core`, then run `pnpm --filter @tally/indexer core:sync`. `pnpm build` and `test/standalone.test.ts` fail on any drift.
- **No workspace dependencies.** `envio` and the dev tools are pinned to exact versions, because Envio Cloud ignores the pnpm lockfile. The ABI is committed in `abis/` and checked against the Foundry build in the monorepo.
- **Hosted build simulated locally.** `pnpm --filter @tally/indexer verify:standalone` copies only the uploadable files to a temp directory outside the workspace. It installs them with `pnpm@10.32.0` and no lockfile, then runs codegen, `tsc` and the unit tests there.

Before connecting, run the local checks:

```bash
pnpm --filter @tally/indexer verify:standalone   # simulated hosted build, no network deploy
pnpm --filter @tally/indexer testnet:check       # env == verified manifest, code exists on 10143
```

Then set up Envio Cloud (https://envio.dev/app). Connect the GitHub repository and set:

| Setting           | Value                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| Indexer Directory | `packages/indexer`                                                                    |
| Config File       | `config.monad-testnet.yaml`                                                           |
| Branch            | the deployment branch (pushing to it triggers a build)                                |
| Plan              | Development (free) for the hackathon; check its current limits in the dashboard first |

Set these environment variables in the Envio Cloud dashboard, never in the repo:

| Variable                         | Value                      | Secret?                                  |
| -------------------------------- | -------------------------- | ---------------------------------------- |
| `ENVIO_TALLY_LEDGER_ADDRESS`     | `manifest.address`         | No                                       |
| `ENVIO_TALLY_LEDGER_START_BLOCK` | `manifest.deploymentBlock` | No                                       |
| `ENVIO_API_TOKEN`                | HyperSync token from Envio | **Yes.** Never in the web app or in logs |

Hosted variables must start with `ENVIO_`, which both config variables already do.

#### Health checks

- **Envio Cloud dashboard / CLI:** sync status and progress, latest indexed block, logs and alerts. `envio-cloud deployment status --watch-till-synced` waits for the initial sync, and `envio-cloud deployment metrics` reports throughput. Run `envio-cloud --help` to confirm the exact flags for your CLI version.
- **GraphQL:** `{ _meta { chainId progressBlock isReady } }` returns `isReady: true` when the indexer is caught up. Compare `progressBlock` with the chain head.
- **In the app:** the indexer-health pill uses that same `_meta` subscription and shows the lag and offline banners.
- **Self-hosted:** `GET http://<host>:9898/healthz` checks the indexer process; the Hasura endpoint is on port 8080.

#### Production GraphQL URL

Envio Cloud assigns the URL after a deployment syncs. Get it from the dashboard, or from `envio-cloud deployment endpoint` and `envio-cloud deployment promote`. Promoting gives a stable URL that survives redeploys. Pass it to the web app with `env:testnet --indexer <url>` (step 8). It is not hardcoded anywhere, and none exists yet.

#### Fallback: self-host

If Envio Cloud is unavailable, self-host. Run `pnpm --filter @tally/indexer start:testnet`, which runs the same env check first. It needs Docker, Postgres and Hasura, plus the same three variables in `packages/indexer/.env`. Put Hasura behind HTTPS and expose only its public, read-only role. Don't expose the admin secret.

### 8. Web app

```bash
pnpm --filter @tally/web env:testnet --indexer https://<your-indexer>/v1/graphql --rp-id <your-domain> > apps/web/.env.local
pnpm build && pnpm --filter @tally/web start
```

It prints the values from the verified manifest and refuses while nothing is deployed.

Safeguards that stay on:

- chain-ID check before every send
- passkey wallets as the only signers on testnet (no demo accounts)
- simulate before signing; "confirmed" only after a successful receipt
- indexer-lag and offline banners
- `settlementToken()` compared with `NEXT_PUBLIC_AUSD_ADDRESS`
- MockToken minting and "Add test MON" exist only in local-demo mode

## End-to-end verification checklist (after deployment)

Use two passkey wallets, A and B, each funded with MON from faucet.monad.xyz. For each step:

- check the event on Monadscan (the transaction's Logs tab)
- check the indexer with GraphQL
- check the app UI

| #   | Action (who)                                        | Expected on-chain event(s)                                                                                      | Explorer check                                 | Indexer / app check                                                                                                           |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | A creates group "Testnet trip" with B               | `GroupCreated(groupId, A, name)`, `MemberAdded(groupId, A, A)`, `MemberAdded(groupId, B, A)`, all in **one tx** | 3 logs in one tx                               | `Group(id)` with `memberCount: 2`; app opens the group                                                                        |
| 2   | A adds C (a third wallet), C leaves at zero balance | `MemberAdded`, then `MemberRemoved(groupId, C, C)`                                                              | 2 txs                                          | `Membership` for C has `active: false`                                                                                        |
| 3   | A records 10 AUSD equal split, A and B              | `ExpenseRecorded(…, splitType 0, [sorted], [5e6, 5e6], …)`                                                      | shares sum to amount                           | A `+5.00`, B `-5.00`                                                                                                          |
| 4   | B records 3 AUSD custom split: A 2, B 1             | `ExpenseRecorded(…, splitType 1, …)`                                                                            | shares `[…]` match                             | balances update; activity feed shows it                                                                                       |
| 5   | 1 AUSD equal split among 3 (needs 3 members)        | shares differ by at most 1 unit, the lowest address gets the extra unit                                         |                                                | matches the app's preview                                                                                                     |
| 6   | A marks 1 AUSD as received from B                   | `SettlementRecorded(…, kind 1)`, **no** `Transfer`, **no** `TokenSettled`                                       | no token transfer in the tx                    | "Marked as received · no tokens moved"                                                                                        |
| 7   | B gets AUSD: `requestFunds(B)` on the Agora faucet  | `FundsRequested(B, 10000e6)`, AUSD `Transfer`                                                                   | B's AUSD balance                               | Settle screen shows B's balance                                                                                               |
| 8   | B approves the exact amount                         | AUSD `Approval(B, ledger, amount)`                                                                              | allowance equals amount                        | step 1 shows "Done"                                                                                                           |
| 9   | B pays A with AUSD                                  | `SettlementRecorded(…, kind 2)`, `TokenSettled(…, AUSD, amount)`, AUSD `Transfer(B→A)`, in **one tx**           | A's AUSD +amount, ledger AUSD balance stays 0  | "Paid in AUSD"; `tokenTransferConfirmed: true`                                                                                |
| 10  | Over-payment attempt                                | reverts in simulation with `SettlementExceedsDebt`; **no tx sent**                                              | none                                           | app shows the error before signing                                                                                            |
| 11  | Balance reconstruction                              | n/a                                                                                                             | `netBalance(groupId, member)` with `cast call` | matches indexer `Membership.netBalance` and `@tally/core` recomputation (`packages/indexer/test/local-chain.test.ts` pattern) |
| 12  | Live updates                                        | n/a                                                                                                             | n/a                                            | a second browser on the group page updates without reload; the header pill shows lag while indexing                           |

Record the transaction hashes from this checklist in the PR or release notes. Only after that is
"live testnet integration verified" true.

## Rollback limitations

- `TallyLedger` has **no owner, no pause and no upgrade.** A deployed ledger can't be changed, fixed or stopped.
- The settlement token is **immutable.** A different token means a new deployment.
- "Rolling back" means deploying a new ledger and pointing the indexer (address and start block) and the web app at it.
  - The old ledger and its balances keep existing on-chain; history doesn't migrate.
  - Users should revoke any AUSD allowance they gave the old ledger.
- Envio Cloud can switch between indexer versions, but that only changes the read model, never on-chain state.
- Passkey wallets are unaffected by redeployments: same passkey, same address.

## Outstanding manual actions and blockers

1. Create the deployer keystore (or connect a Ledger) and fund it with MON.
2. Review the preflight with an approver, then run broadcast and record (steps 3–5).
3. Verify the source on the explorer (step 6).
4. Get an `ENVIO_API_TOKEN`, then create the Envio Cloud project and set its environment variables. Push the branch, wait for the sync and promote the deployment (step 7). The hosted build has been simulated locally but has not run on Envio Cloud.
5. Choose and configure the production domain (`NEXT_PUBLIC_PASSKEY_RP_ID`) and host the web app.
6. Run the end-to-end checklist on testnet and record the transaction hashes.
