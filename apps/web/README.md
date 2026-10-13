# @tally/web

Mobile-first Tally app (Next.js 16, React 19, Tailwind CSS 4, viem). It reads everything from the
Envio indexer (`packages/indexer`) and sends transactions straight to the `TallyLedger`
contract. There is no backend.

## Network modes

Set `NEXT_PUBLIC_TALLY_NETWORK` in `apps/web/.env.local` (see `.env.example`). The app never
switches networks by itself.

| Mode            | What works                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-demo`    | Everything, against a local anvil node. Anvil's unlocked dev accounts sign ("Demo 0–9"); no keys in the browser. Uses the test **MockToken**, not AUSD.    |
| `monad-testnet` | Passkey wallets sign; anyone can view an address read-only. Needs a real deployment and indexer URL; **none exists yet**, so the app shows a setup screen. |
| unset           | A setup screen listing what's missing. No made-up data.                                                                                                    |

Every write first checks the node's chain ID against the configured one and refuses to send if
they differ.

## Run the local demo

Needs Docker (for the indexer), Foundry and pnpm. In separate terminals:

```bash
# 1. Local chain + demo deployment (packages/contracts)
anvil --network monad
cd packages/contracts
forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# 2. Indexer + GraphQL on http://localhost:8080 (packages/indexer)
pnpm --filter @tally/indexer dev

# 3. The app on http://localhost:3000
echo "NEXT_PUBLIC_TALLY_NETWORK=local-demo" > apps/web/.env.local
pnpm dev
```

Pick a demo account at the top. Demo 0–3 are in the "Trip" group, Demo 1–2 in "Flat".
Restarting anvil resets the chain; restart the indexer too (`pnpm --filter @tally/indexer stop`,
then `dev`). If styles look stale after editing `globals.css`, stop `next dev` and delete
`apps/web/.next`.

## Passkey wallets (Mera)

`/account` lets people create or sign in with a passkey (Face ID, Touch ID, device PIN) and get
a wallet they own. It uses [Mera](https://mera.category.xyz/) `@category-labs/mera@0.2.0`
(preview; API may change before 1.0) and only its documented APIs:
`createPasskeyWithPrfOutput`, `getPasskeyPrfOutput`, `createSecp256k1SigningSession`,
`getEvmAddress` and `toViemAccount`.

**Verified capabilities (from the SDK's types and docs):**

| Question        | Answer                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account type    | An EOA whose key is derived from the passkey's WebAuthn **PRF** output (BIP-39 → `m/44'/60'/0'/0/0`, Mera's recipe). With gasless on, it is upgraded to a smart account on first use via **EIP-7702** (Mera's `signAuthorization`), delegating to `TallyAccount`. |
| Gas sponsorship | Mera has none. Tally adds its own: with `NEXT_PUBLIC_GASLESS`, Tally's sponsor (`/api/relay`) pays fees, so passkey wallets need no MON (see "Gasless" below). Otherwise the wallet pays its own MON.                                                             |
| Recovery        | Signing in with the **same passkey** on another device (synced by iCloud Keychain, Google Password Manager or 1Password) recreates the same wallet. If the passkey is deleted, the wallet can't be recovered. Tally offers no export.                             |
| Authenticators  | Need PRF: iCloud Keychain (Safari/Chrome/Firefox, iOS 18+/macOS 15+), Google Password Manager, 1Password, Windows 11 25H2+, YubiKey 5. **Not**: Chrome's local profile, Bitwarden, Dashlane ([Mera's list](https://mera.category.xyz/authenticator-support/)).    |
| Backend         | Only the gas sponsor (`/api/relay`), when gasless is on. Keys and sessions stay in the browser.                                                                                                                                                                   |

**Session model:**

- The private key exists only inside an in-memory Mera signing session. It is never stored or
  logged. Ending the session zeroes it (Mera's `end()`); derivation buffers are wiped too.
- The wallet locks after 10 minutes without use, on "Lock now", on sign-out, on `pagehide`
  and on every page reload. Unlocking needs the passkey again.
- `localStorage` holds only what Mera's recipe recommends (the credential ID and transport
  hints) plus the public address, and which account source you chose. None of these can sign.
- Unlock never silently switches accounts. A different passkey is only accepted via
  "Switch to another passkey".

**Who can send:** every transaction goes through one guard (`resolveSigner` +
`useTransaction`). It checks, before anything is signed, that the current identity may sign for
exactly that sender (view-only never; demo accounts only in the local demo; passkey wallets only
when unlocked and only as themselves), that the node is on the configured chain, and that the
call simulates without reverting. Approval, allowance and settlement-limit checks are unchanged.
Switching identity remounts the page so no form or pending state carries over.

**Domain (rpId):** passkeys are bound to a domain. `NEXT_PUBLIC_PASSKEY_RP_ID` defaults to the
page's hostname; set it to your production domain before launch, because passkeys made on
`localhost` or a preview URL won't work on the real site.

**Security headers** (`next.config.ts`): a CSP whose `connect-src` only allows this origin and
the configured RPC and indexer, `frame-ancestors 'none'`, a passkey-only `Permissions-Policy`,
`nosniff` and `no-referrer`. Mera warns that any injected script can use a live session, so the
narrow `connect-src` is the key mitigation. **Limitation:** inline scripts are still allowed,
because nonce-based CSP needs fully dynamic rendering, which Cache Components' static shells
don't use.

**How it was tested:** unit tests drive the real Mera code with an injected fake authenticator
(Mera's `webAuthnClient` option). Browser tests use Chromium's virtual WebAuthn authenticator
with PRF (DevTools protocol), so the real `navigator.credentials` path runs. **No physical
device or real Face ID / Touch ID prompt has been tested.**

## Gasless passkey wallets (EIP-7702 + sponsor)

With `NEXT_PUBLIC_GASLESS=true` (on by default in the local demo), passkey wallets never need MON:

1. **First use:** the wallet signs an EIP-7702 authorization delegating to `TallyAccount`
   (`packages/contracts/src/TallyAccount.sol`, built on OpenZeppelin 5.7: ERC-7821 batches,
   `SignerEIP7702`, EIP-712). The sponsor submits it; the wallet becomes a smart account.
2. **Every action:** the app simulates the batch, the wallet signs one EIP-712 `Execute`
   (exact calls, one-time nonce, ≤ 10-minute deadline), and `/api/relay` submits
   `executeWithSignature`, paying the fee. The sponsor can't change what was signed.
3. **One-tap pay:** approve + `settleWithToken` go in one signed batch.

The sponsor (`src/lib/relay/`) only pays for Tally: TallyLedger member actions and AUSD
`approve` for the ledger (plus MockToken mints on the local chain), at most 4 calls, value 0. It
checks the delegation was signed by the wallet itself, simulates before spending, caps gas,
stops below 0.05 MON, sends one transaction at a time, and rate-limits per wallet and client
(per server instance: a first line of defence, not a guarantee). `SPONSOR_PRIVATE_KEY` is a
server-only variable, read at request time and never sent to the browser; public anvil keys
are refused on any non-local chain. Local demo accounts keep paying their own gas.

## Invite links

The admin taps **Create invite link** (Members). The app makes a random invite key, registers
only its address on-chain (`setInviteSigner`), and shows `…/join/<group>#k=<key>` with a QR
code. The key lives in the `#fragment`, which browsers never send to a server. On `/join`, the
friend creates a passkey wallet if needed, then the app signs "this address joins this group"
with the key and sends `joinWithInvite`. The key never goes on-chain, and a signature only
works for the address it names. **Reset link** registers a new key (old links stop working);
**Turn off** disables invites. Anyone holding a live link can join, so share it like a password.

## Screens

| Route                       | What it does                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Totals you owe / are owed (per group, never netted across groups), your groups, recent activity                             |
| `/groups/new`               | Create a group; you become admin; optional initial members                                                                  |
| `/groups/[id]`              | Your balance and who you pay / who pays you; tabs: balances + who-owes-whom, expenses (paged), settlements (paged), members |
| `/groups/[id]/expenses/new` | Description, amount, payer (the signer), equal or custom split with live preview                                            |
| `/groups/[id]/settle`       | Pay with AUSD (debtor: approve → pay) or Mark as received (creditor: no tokens move)                                        |
| `/groups/[id]/members`      | Share link; admin adds/removes members by address; members can leave at a zero balance                                      |

### What the app is careful about

- **Money is never a float.** Amounts are parsed and split with `@tally/core` (`parseAmount`,
  `splitEqual`, `splitCustom`) into bigint base units. Equal-split previews match the contract
  exactly (leftover units go to the lowest addresses).
- **Nothing is shown as done before it is.** A transaction is simulated first, then signed, then
  shown as "submitted, not confirmed yet" until its receipt arrives. Only a successful receipt
  says "confirmed" / "Paid". After that, the app waits for the indexer and says so.
- **Acknowledged ≠ paid.** Settlements from `acknowledgeSettlement` are labelled "Marked as
  received · No tokens moved". Only `TOKEN_TRANSFER` settlements whose `TokenSettled` event was
  indexed are labelled "Paid in AUSD".
- **Token payments** show the token read from the ledger (`settlementToken()`), your balance and
  allowance, whether approval is required (exact amount, never unlimited), and the max network
  fee for each step (gas limit × max fee per gas; Monad charges for the full gas limit). The
  amount is checked against the contract's `maxSettleable` right before sending.
- **Indexed data is labelled.** The header shows live / behind / offline from Envio's `_meta`
  versus the node's block number. If the indexer is unreachable, balances aren't shown at all.
  If the WebSocket drops, the app polls over HTTP and says so.
- **Invitations are what the contract supports:** a shareable group link plus admin-only
  `addMember`. There is no self-join or invite code.

## Data sources

- **Envio GraphQL** (`NEXT_PUBLIC_INDEXER_GRAPHQL_URL`): every list and balance, via HTTP and
  `graphql-transport-ws` subscriptions (one shared socket, reconnect with backoff). Queries use
  Hasura's public role; the admin secret is never used.
- **Contract reads** (viem): `settlementToken`, `maxSettleable`, token balance and allowance,
  plus transaction receipts. Used to confirm and guard transactions, not to replace the indexer.

## Tests

```bash
pnpm --filter @tally/web test       # Vitest: config, formatting, split form, tx state machine,
                                    # balances, indexer parsers, WebSocket client, components
pnpm --filter @tally/web test:e2e   # Playwright at 1440×900, 834×1112, 430×932 and 390×844,
                                    # incl. passkeys via a virtual PRF authenticator
```

The Playwright suite needs the local demo running (steps 1–3). `e2e/flows.spec.ts` sends real
transactions to the **local** anvil chain (expense, mint test tokens, approve, pay, acknowledge)
and runs only at 390×844. It is not part of `pnpm check`. First run:
`pnpm --filter @tally/web exec playwright install chromium`.

## Blocked until a public deployment

- Any use of real Agora AUSD on Monad testnet (needs a deployed `TallyLedger`).
- `monad-testnet` mode beyond the setup screen (needs the ledger address and an indexer URL).
- Passkey wallets on a real network: they work, but need the deployment above, MON for fees
  (testnet faucet), and `NEXT_PUBLIC_PASSKEY_RP_ID` set to the real domain.
