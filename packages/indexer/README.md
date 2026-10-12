# @tally/indexer

Envio HyperIndex (v3, `envio@3.13.0`) read layer for `TallyLedger`. It turns contract events into
queryable entities and serves them through Envio's generated GraphQL API (Hasura). It is
**read-only**: it never sends transactions, and the contract remains the source of truth.

## Status

| What                                            | Verified?                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Handlers, entities, balances (simulated events) | Yes: `pnpm test`                                                        |
| Real logs from a local anvil deployment         | Yes: `test:local-chain`, plus GraphQL and subscriptions via `envio dev` |
| Monad testnet config parses and generates code  | Yes, with placeholder values                                            |
| Self-contained hosted build (no workspace deps) | Yes: `verify:standalone` (simulated locally, outside the workspace)     |
| Indexing a real Monad testnet deployment        | **No**: nothing is deployed yet, and HyperSync needs an API token       |
| Envio Cloud deployment                          | **No**: not created yet                                                 |

## Layout

```
config.yaml                 LOCAL ANVIL ONLY (chain 31337, deterministic LocalDemo address)
config.monad-testnet.yaml   Monad testnet (chain 10143); address + start block from env
schema.graphql              Entities (below)
abis/TallyLedger.json       Copied from the Foundry build (`pnpm abi:sync`, checked in `build`)
src/core/                   GENERATED copy of the @tally/core modules used (`pnpm core:sync`)
src/ledger.ts               Pure event → core mapping and consistency checks
src/handlers/TallyLedger.ts Event handlers
test/                       Unit, simulated-replay and local-chain tests
```

## Entities

| Entity          | ID                     | Notes                                                                              |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `Group`         | `groupId`              | Name, admin, counters, totals (`totalTokenSettled` vs `totalAcknowledged`)         |
| `Membership`    | `groupId-address`      | `active`, current `netBalance`, `totalPaid`, `totalOwedShares`; kept after removal |
| `Account`       | address                | `memberships` → a user's groups                                                    |
| `Expense`       | `groupId-expenseId`    | Payer, amount, `EQUAL`/`CUSTOM`, description, tx hash, block, log index            |
| `ExpenseShare`  | `expense-address`      | One per participant, in contract order (`position`)                                |
| `Settlement`    | `groupId-settlementId` | `kind`: `ACKNOWLEDGED` or `TOKEN_TRANSFER`; `token` + `tokenTransferConfirmed`     |
| `GroupActivity` | `blockNumber-logIndex` | Per-group feed; `sequence` increases by one per event                              |

All amounts are AUSD base units (6 decimals); all addresses are lowercase
(`address_format: lowercase`), matching `@tally/core`.

### How events map

| Event                | Effect                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `GroupCreated`       | New `Group`                                                                                       |
| `MemberAdded`        | New or reactivated `Membership`, `Account`                                                        |
| `MemberRemoved`      | `Membership.active = false` (balance is always 0 on-chain at removal)                             |
| `ExpenseRecorded`    | `Expense` + `ExpenseShare`s; balances via core's `ledgerEntryDeltas`                              |
| `ExpenseUndone`      | `Expense.undone = true`; exact reversal via core's `expenseUndone` entry; counts and totals drop  |
| `SettlementRecorded` | `Settlement`; balances via `ledgerEntryDeltas`. **The only place a settlement changes balances.** |
| `TokenSettled`       | Confirms a `TOKEN_TRANSFER` settlement and records the token. Never changes balances.             |

An acknowledgement (`kind = ACKNOWLEDGED`) is never shown as a token payment: its `token` is null
and `tokenTransferConfirmed` is false. Only query `kind: TOKEN_TRANSFER, tokenTransferConfirmed:
true` when you need proof that tokens moved.

Each expense is re-checked against `@tally/core` (`splitEqual` for equal splits, `splitCustom`
for totals) and each settlement against `maxSettleable`. The contract already enforces these, so
a disagreement is logged as an error rather than silently "fixed"; the contract's data is kept.

## Ordering, re-delivery and reorgs

- Events are processed in chain order. `GroupActivity` keeps `(blockNumber, logIndex)` and a
  per-group `sequence`.
- Handlers are idempotent: each event is keyed by its chain position, and expense and settlement
  IDs are unique per group on-chain, so a re-delivered event changes nothing (tested).
- Reorgs: `rollback_on_reorg: true`. Envio rolls back every entity on a reorg up to
  `max_reorg_depth` (default 200 blocks). Envio guarantees detection only with HyperSync; with a
  plain RPC some reorgs may go undetected. Handlers have no external side effects, so a rollback
  is complete.
- If the indexer's start block is after the contract's deployment, it stops with
  `Group N is not indexed…` rather than producing wrong balances.

## Local development (anvil)

Requires Docker for `envio dev` (Postgres + Hasura). From the repository root:

```bash
# 1. Local chain with Monad execution semantics
anvil --network monad

# 2. Deploy MockToken + TallyLedger and record demo history (local only, no keys needed)
cd packages/contracts
forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# 3. Index it and open GraphQL (Hasura console admin secret: testing)
cd ../indexer
pnpm dev            # http://localhost:8080
pnpm stop           # deletes the local database and containers
```

The demo's `TallyLedger` lands at `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` only on a fresh
anvil. If you've sent other transactions first, update `config.yaml`.

Tests:

```bash
pnpm --filter @tally/indexer test                # simulated events; no chain, no Docker
pnpm --filter @tally/indexer test:local-chain    # real logs; needs steps 1-2 above
```

## Monad testnet

No `TallyLedger` is deployed yet. After you deploy one:

```bash
cp .env.example .env    # ENVIO_API_TOKEN, ENVIO_TALLY_LEDGER_ADDRESS, ENVIO_TALLY_LEDGER_START_BLOCK
pnpm dev:testnet
```

The indexer refuses to start without the address and start block; there is no default.
Monad testnet is supported by HyperSync (`https://monad-testnet.hypersync.xyz`), which requires
`ENVIO_API_TOKEN`. To use an RPC instead, add an `rpc` entry with `for: sync` to the chain in
`config.monad-testnet.yaml` (reorg detection is weaker over RPC).

## Hosting (Envio Cloud)

Envio Cloud builds only this directory, so it must not import anything outside it.

- `src/core/` is a byte-identical, generated copy of the `@tally/core` accounting modules. Never edit it. Change `packages/core` and run `pnpm core:sync`. `pnpm build` and `test/standalone.test.ts` fail on any drift, on `@tally/*` imports, and on relative imports that leave the directory.
- Dependencies are pinned exactly, because the hosted build ignores the lockfile.
- `pnpm verify:standalone` simulates the hosted build in a temp directory, with `pnpm@10.32.0` and no lockfile.

Settings, secrets, health checks and how to get the GraphQL URL are in [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md#7-indexer).

## GraphQL

Local endpoint: `http://localhost:8080/v1/graphql`. Hasura generates `where`, `order_by`,
`limit` and `offset` for every entity. Verified against the local deployment:

```graphql
# A user's groups and their balance in each
query UserGroups($address: String!) {
  Membership(
    where: { address: { _eq: $address }, active: { _eq: true } }
    order_by: { group_id: asc }
  ) {
    netBalance
    group {
      id
      name
      memberCount
    }
  }
}

# Members and current balances of a group
query GroupBalances($groupId: String!) {
  Group(where: { id: { _eq: $groupId } }) {
    name
    totalTokenSettled
    totalAcknowledged
    members(where: { active: { _eq: true } }, order_by: { address: asc }) {
      address
      netBalance
    }
  }
}

# Expenses, newest first, paginated, with shares
query GroupExpenses($groupId: String!, $limit: Int!, $offset: Int!) {
  Expense(
    where: { group_id: { _eq: $groupId } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: $limit
    offset: $offset
  ) {
    description
    amount
    splitType
    payer
    txHash
    shares(order_by: { position: asc }) {
      member
      amount
    }
  }
}

# Settlements; filter on kind to separate real payments from acknowledgements
query GroupSettlements($groupId: String!) {
  Settlement(
    where: { group_id: { _eq: $groupId } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
  ) {
    debtor
    creditor
    amount
    kind
    token
    tokenTransferConfirmed
    txHash
  }
}
```

`BigInt` values are returned as strings; parse them with `BigInt(...)`. Suggested payments are
not indexed: compute them on the client with `simplifyDebts` from `@tally/core`.

## Subscriptions

Hasura serves GraphQL subscriptions over WebSockets at the same path (`ws://` / `wss://`), using
the `graphql-transport-ws` protocol. Any query above works as a `subscription`:

```graphql
subscription GroupFeed($groupId: String!) {
  GroupActivity(
    where: { group_id: { _eq: $groupId } }
    order_by: { sequence: desc }
    limit: 20
  ) {
    sequence
    activityType
    actor
    amount
    txHash
  }
}
```

Updates are not instant. A change appears only after (1) the transaction is in a block, (2) the
indexer has fetched and processed that block, and (3) Hasura re-polls the subscription (Hasura
live queries poll, by default about once per second). Locally this took about 1.7 s from
`cast send` to the pushed update. On testnet expect more, and treat subscription data as
"indexed so far", not as confirmation. Envio's hosted service only fully supports WebSockets
on dedicated plans; on other plans Envio advises against relying on more than ~10 connections.
