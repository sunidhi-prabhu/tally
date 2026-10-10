# Tally

Mobile-first expense splitting with stablecoin settlement on Monad. Built for the Monad Metropolis hackathon.

Planned: passkey sign-in (Mera), groups and invites, expense splits and simplified debts, settlement in Agora AUSD, cross-chain top-ups via Aurora Intents, and real-time sync via Envio HyperIndex.

## Status

| Area                             | Status                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo and tooling             | Done                                                                                                                                                                                          |
| Web app (`apps/web`)             | Dashboard, groups, expenses, settlements, members; Mera passkey wallets; full flows verified on the local anvil demo (passkeys via a virtual authenticator); Monad testnet needs a deployment |
| Shared logic (`packages/core`)   | Money, splits, balances, settlement kinds, debt simplification, schemas                                                                                                                       |
| Contracts (`packages/contracts`) | `TallyLedger`: groups, expenses, balances, AUSD token settlement; tested locally with a mock token and on a local fork of real testnet AUSD; not deployed                                     |
| Indexer (`packages/indexer`)     | Envio HyperIndex read layer; verified on a local anvil deployment (handlers, GraphQL, subscriptions); not running against Monad testnet                                                       |
| Aurora Intents, deployment       | Not started                                                                                                                                                                                   |

Nothing has been deployed and no integration has been verified on a live network. Monad testnet deployment is prepared and gated behind human approval: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

| Tool    | Version    | Notes                                                             |
| ------- | ---------- | ----------------------------------------------------------------- |
| Node.js | >= 22.15   | Developed on 24.x                                                 |
| pnpm    | 12.6.0     | Pinned via `packageManager`; enable with Corepack (below)         |
| Foundry | >= 1.8.0   | Earlier versions lack Monad execution support. Developed on 1.8.5 |
| Git     | any recent | `forge-std` is a submodule                                        |

### Install pnpm (via Corepack)

```bash
corepack enable pnpm
```

If that fails with a permission error on `/usr/local/bin`, install the shim in your home directory instead and add it to your PATH:

```bash
mkdir -p ~/.local/bin
corepack enable pnpm --install-directory ~/.local/bin
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

### Install Foundry

```bash
curl -L https://getfoundry.sh/install | bash
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.zshrc   # if the installer did not add it
foundryup
forge --version   # must be >= 1.8.0
```

## Setup

```bash
git clone --recurse-submodules https://github.com/sunidhi-prabhu/tally.git
cd tally
pnpm install
cp apps/web/.env.example apps/web/.env.local                # optional for now
cp packages/contracts/.env.example packages/contracts/.env  # optional for now
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive`.

## Workspace structure

```
apps/
  web/              Next.js 16 (App Router, TypeScript, Tailwind CSS 4)
packages/
  core/             Framework-independent TypeScript: money, splits, validation, debt simplification
  contracts/        Foundry project (Solidity), configured for Monad
  indexer/          Envio HyperIndex: contract events → GraphQL (see packages/indexer/README.md)
```

## Commands

Run from the repository root:

| Command             | What it does                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`          | Start the web app at http://localhost:3000 (see apps/web/README.md for the local demo) |
| `pnpm build`        | Production build of the web app and `forge build` of contracts                         |
| `pnpm lint`         | ESLint for the web app and core package                                                |
| `pnpm typecheck`    | TypeScript checks (`next typegen && tsc` for the web app)                              |
| `pnpm test`         | Vitest for core, `forge test` for contracts                                            |
| `pnpm format`       | Prettier for TS/JSON/MD/CSS, `forge fmt` for Solidity                                  |
| `pnpm format:check` | Check formatting without writing                                                       |
| `pnpm check`        | All of the above checks in sequence                                                    |

## Environment and secrets

- Real environment files (`.env`, `.env.local`, etc.) are ignored by Git. Only `.env.example` files are tracked.
- Every `NEXT_PUBLIC_` variable is visible in the browser. Never put secrets in them.
- Contract deployment will use an encrypted Foundry keystore. Never put a private key or seed phrase in any file in this repository.

## Networks (reference)

| Network       | Chain ID | Public RPC                      |
| ------------- | -------- | ------------------------------- |
| Monad testnet | 10143    | `https://testnet-rpc.monad.xyz` |
| Monad mainnet | 143      | `https://rpc.monad.xyz`         |

Source: [Monad docs](https://docs.monad.xyz/developer-essentials/testnet).
