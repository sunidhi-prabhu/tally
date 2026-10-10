// Network facts for deployment tooling. Testnet and mainnet are kept separate on purpose:
// nothing in this tooling targets mainnet, and mainnet values exist only to be rejected.

export const MONAD_TESTNET = Object.freeze({
  key: "monad-testnet",
  chainId: 10143,
  publicRpc: "https://testnet-rpc.monad.xyz",
  explorer: "https://testnet.monadscan.com",
  explorerAlt: "https://testnet.monadvision.com",
  monFaucet: "https://faucet.monad.xyz",
  ausd: Object.freeze({
    // https://docs.agora.finance/developer/contract-deployments (Monad Testnet), checked on-chain
    // 2026-10-10: symbol "AUSD", 6 decimals, EIP-1967 proxy.
    address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    symbol: "AUSD",
    decimals: 6,
    // Agora faucet: requestFunds(address); 10,000 AUSD per drip, 100,000 AUSD cap per holder,
    // at most one drip per 60 s (read on-chain 2026-10-10).
    faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
  }),
});

/** Listed only so tooling can reject them. */
export const MONAD_MAINNET = Object.freeze({
  chainId: 143,
  publicRpcHosts: [
    "rpc.monad.xyz",
    "rpc1.monad.xyz",
    "rpc2.monad.xyz",
    "rpc3.monad.xyz",
    "rpc-mainnet.monadinfra.com",
  ],
  ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
});

/** anvil/hardhat default accounts 0-9. Their keys are public. */
export const ANVIL_DEV_ACCOUNTS = Object.freeze(
  [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
    "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  ].map((a) => a.toLowerCase()),
);

/** The compiler configuration all tests ran under. Deployment must use exactly this. */
export const EXPECTED_COMPILER = Object.freeze({
  solc: "0.8.37",
  evm_version: "osaka",
  optimizer: false,
  via_ir: false,
  network: "monad",
  hardfork: "monad:MonadNine",
});

export const SCRIPT_PATH =
  "script/DeployTallyLedgerTestnet.s.sol:DeployTallyLedgerTestnet";
export const SCRIPT_BROADCAST_DIR = "DeployTallyLedgerTestnet.s.sol";
export const MANIFEST_PATH = "deployments/monad-testnet.json";
