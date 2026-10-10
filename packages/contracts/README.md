# @tally/contracts

Foundry project for Tally's Solidity contracts, initialized with `forge init --network monad`.

## TallyLedger

`src/TallyLedger.sol` keeps per-group net balances in AUSD base units (6 decimals), mirroring the
rules in `packages/core`. Positive balance: owed money. Negative: owes money. A group's balances
always sum to zero.

### Two kinds of settlement

| Function                | Caller   | Tokens move?                      | Recorded as                    |
| ----------------------- | -------- | --------------------------------- | ------------------------------ |
| `settleWithToken`       | Debtor   | Yes: debtor → creditor, same tx   | `SettlementKind.TokenTransfer` |
| `acknowledgeSettlement` | Creditor | **No**: an accounting record only | `SettlementKind.Acknowledged`  |

Only `TokenTransfer` proves a payment. Read the kind with `settlementKind(groupId, id)` or from the
`SettlementRecorded` event; `TokenSettled` is emitted only when tokens moved. Both kinds share one
ID namespace and the same debt limit, and both reduce balances identically.

`settleWithToken` (debtor must first `approve` the ledger for at least `amount` on the token):

1. Checks: caller and recipient are members, not the same address, ID unused and non-zero,
   `1 <= amount <= MAX_AMOUNT`, and `amount <= maxSettleable(groupId, caller, to)`.
2. Effects: records the ID and updates both balances.
3. Interaction: `transferFrom(caller, to, amount)` on the settlement token. Accepts `true` or no
   return data; bubbles the token's revert reason; rejects `false`.
4. Verifies `to`'s token balance rose by exactly `amount` (rejects fee-on-transfer or any future
   change in the upgradeable token's behaviour).

Any failure reverts the whole call, so balances and the ID are untouched. Every state-changing
function is `nonReentrant`. The ledger never holds tokens and only ever pulls from `msg.sender`.

### Settlement token

`settlementToken` is set once in the constructor and cannot be changed (there is no owner). The
constructor rejects addresses without code and tokens whose `decimals()` is not 6. The intended
token on Monad testnet is Agora AUSD, `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`
([Agora deployments](https://docs.agora.finance/developer/contract-deployments); on-chain: symbol
`AUSD`, 6 decimals, EIP-1967 upgradeable proxy). Re-verify before deploying.

| Action                       | Who                     | Key rules                                                        |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `createGroup`                | Anyone                  | Caller becomes admin and first member; ≤ 100 members             |
| `addMember` / `removeMember` | Group admin             | Removal only at a zero balance; the admin cannot be removed      |
| `leaveGroup`                 | Any member except admin | Only at a zero balance                                           |
| `recordEqualExpense`         | A member, as the payer  | Participants: current members, sorted ascending, no duplicates   |
| `recordCustomExpense`        | A member, as the payer  | Shares parallel to participants and summing to `amount` exactly  |
| `settleWithToken`            | The debtor (`from`)     | Caller owes, `to` is owed, amount ≤ `maxSettleable`; pays now    |
| `acknowledgeSettlement`      | The creditor (`to`)     | `from` owes, caller is owed, amount ≤ `maxSettleable`; no tokens |

- Amounts per expense or settlement: `1 ..= MAX_AMOUNT` (1e18 = 1 trillion AUSD), same as core.
  Balances can grow beyond that; such debts are settled in several parts.
- Equal splits: `amount / n` each; the `amount % n` leftover units go one each to the lowest
  addresses (participants are passed in ascending order). Matches `splitEqual` in core for
  lowercase addresses.
- Expense and settlement IDs are caller-chosen non-zero `bytes32`, unique per group.
- Events (`GroupCreated`, `MemberAdded`, `MemberRemoved`, `ExpenseRecorded` with participants and
  shares, `SettlementRecorded` with its kind) are enough to rebuild membership, expenses and
  balances. `TokenSettled` adds the token address for actual payments.
- The ledger and token contracts cannot be added as group members.

## Configuration

`foundry.toml` sets:

- `network = "monad"` so local builds and tests use Monad execution semantics (Foundry >= 1.8.0).
- `hardfork = "monad:MonadNine"` to match the revision Monad's docs list for testnet and mainnet.
  The resolved `evm_version` is `osaka`; Monad's changelog says MONAD_NINE activates the Osaka EIPs
  including CLZ (EIP-7939). This has not been verified by deploying.
- `solc = "0.8.37"`.
- `fs_permissions`: read-only access to `test/fixtures` for the core cross-check.
- `[invariant]`: 128 runs × 200 calls, `fail_on_revert = true`.
- `[lint]`: `require-revert-in-loop` is excluded because validation loops revert by design.

`forge-std` is a Git submodule at `lib/forge-std` (v1.17.0).

## Tests

| File                         | What it covers                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TallyLedger.t.sol`          | Groups, membership and authorization, expenses, settlements, reverts                                                                            |
| `TallyLedgerFuzz.t.sol`      | Equal and custom splits, amount bounds, settlement limits                                                                                       |
| `TallyLedgerInvariant.t.sol` | Random operation sequences checked against an independent model                                                                                 |
| `TallyLedgerToken.t.sol`     | Token settlement: success, allowance/balance failures, recipients, authorization, overpayment, duplicates, reentrancy, misbehaving tokens, fuzz |
| `CoreFixtures.t.sol`         | Replays `test/fixtures/core-fixtures.json`, produced by packages/core                                                                           |
| `fork/AusdFork.t.sol`        | Opt-in: the ledger against real AUSD bytecode on a local Monad testnet fork                                                                     |

Local tests use `test/mocks/MockToken.sol`, a **test-only** 6-decimal ERC-20 with switchable
misbehaviour. Passing them shows the ledger logic is correct; it says nothing about real AUSD.

### Testing against real AUSD (fork, no funds)

```bash
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz pnpm --filter @tally/contracts test:fork
```

This forks Monad testnet **locally**, deploys the ledger in the fork, funds a test account by
impersonating Agora's faucet contract inside the fork, and settles with the real AUSD contract.
Nothing is broadcast and no real funds are used. It is skipped unless `RUN_FORK_TESTS=true`, so
`pnpm check` stays offline. It is not a substitute for an actual testnet deployment.

The fixture file is generated by `packages/core/src/contract-fixtures.test.ts`. If core behaviour
changes, regenerate it with `pnpm --filter @tally/core test -u`, then run `forge test`.

## Commands

```bash
pnpm --filter @tally/contracts build          # forge build --sizes
pnpm --filter @tally/contracts test           # forge test
pnpm --filter @tally/contracts format:check   # forge fmt --check
```

## Local demo deployment (anvil only)

`script/LocalDemo.s.sol` deploys the test-only `MockToken` and a `TallyLedger` to a local anvil
node and records a demo history covering every event (used by `packages/indexer`). It refuses
to run on any chain other than 31337 and needs no keys:

```bash
anvil --network monad
forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

## Monad testnet deployment

Prepared but not executed. See [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md). In short:
`pnpm deploy:testnet:preflight` (never broadcasts) → human review → `pnpm deploy:testnet:broadcast`
(needs `TALLY_CONFIRM_DEPLOY=monad-testnet:10143` and a typed confirmation) → `pnpm deploy:testnet:record`.
`script/DeployTallyLedgerTestnet.s.sol` refuses any chain but 10143, any token but testnet AUSD,
and anvil dev accounts. `deployments/monad-testnet.json` is filled only from a verified receipt.

Nothing has been deployed to a public network. Deployment will use an encrypted Foundry keystore (`cast wallet import`),
never a raw private key in `.env`.
