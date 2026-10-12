// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {TallyAccount} from "../src/TallyAccount.sol";

interface ITokenMetadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Deploys TallyLedger (settling in Agora AUSD) and TallyAccount (the EIP-7702 smart-
/// account code passkey wallets delegate to) to MONAD TESTNET (chain 10143) only, in one
/// broadcast.
///
/// Never run this directly with --broadcast. Use the guarded wrapper, which runs preflight
/// checks first and asks for explicit confirmation:
///
///   cd packages/contracts && pnpm deploy:testnet:preflight   # simulation only, never broadcasts
///   cd packages/contracts && pnpm deploy:testnet:broadcast   # human-approved deployment
///
/// Signing must come from a Foundry keystore (--account) or a hardware wallet (--ledger). This
/// script never reads a private key. It fails closed on any unexpected chain, token or sender.
contract DeployTallyLedgerTestnet is Script {
    uint256 public constant MONAD_TESTNET_CHAIN_ID = 10143;
    /// Agora AUSD on Monad testnet: https://docs.agora.finance/developer/contract-deployments
    /// Checked on-chain 2026-10-10: symbol "AUSD", 6 decimals, EIP-1967 proxy.
    address public constant MONAD_TESTNET_AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    /// Agora AUSD on Monad MAINNET. Listed only so it can be rejected here.
    address public constant MONAD_MAINNET_AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    /// Foundry's placeholder sender when no --sender/--account is given.
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    error WrongChain(uint256 expected, uint256 actual);
    error MainnetTokenRejected(address token);
    error UnexpectedToken(address expected, address actual);
    error TokenHasNoCode(address token);
    error UnexpectedTokenMetadata(string symbol, uint8 decimals);
    error MissingSender();
    error DevelopmentAccountRejected(address account);
    error PostDeployCheckFailed(string what);

    event Deployed(address ledger, address deployer, address token, uint256 chainId);
    event AccountDeployed(address account);

    /// @notice The TallyAccount deployed alongside the ledger by the last `deploy` call.
    TallyAccount public account;

    /// Entry point for `forge script`: reads AUSD_ADDRESS from the environment.
    function run() external returns (TallyLedger) {
        return deploy(vm.envAddress("AUSD_ADDRESS"));
    }

    function deploy(address token) public returns (TallyLedger ledger) {
        address deployer = msg.sender;
        validate(token, deployer);

        vm.startBroadcast(deployer);
        ledger = new TallyLedger(token);
        account = new TallyAccount();
        vm.stopBroadcast();

        verifyDeployment(ledger, token);
        verifyAccount(account);
        console.log("chainId", block.chainid);
        console.log("deployer", deployer);
        console.log("settlementToken", token);
        console.log("TallyLedger", address(ledger));
        console.log("TallyAccount", address(account));
        emit Deployed(address(ledger), deployer, token, block.chainid);
        emit AccountDeployed(address(account));
    }

    /// Every assumption the constructor and the app rely on, checked before broadcasting.
    function validate(address token, address deployer) public view {
        if (block.chainid != MONAD_TESTNET_CHAIN_ID) {
            revert WrongChain(MONAD_TESTNET_CHAIN_ID, block.chainid);
        }
        if (token == MONAD_MAINNET_AUSD) revert MainnetTokenRejected(token);
        if (token != MONAD_TESTNET_AUSD) revert UnexpectedToken(MONAD_TESTNET_AUSD, token);
        if (token.code.length == 0) revert TokenHasNoCode(token);
        string memory symbol = ITokenMetadata(token).symbol();
        uint8 decimals = ITokenMetadata(token).decimals();
        if (keccak256(bytes(symbol)) != keccak256("AUSD") || decimals != 6) {
            revert UnexpectedTokenMetadata(symbol, decimals);
        }
        if (deployer == address(0) || deployer == FOUNDRY_DEFAULT_SENDER) revert MissingSender();
        if (isAnvilDevAccount(deployer)) revert DevelopmentAccountRejected(deployer);
    }

    function verifyDeployment(TallyLedger ledger, address token) public view {
        if (address(ledger).code.length == 0) revert PostDeployCheckFailed("no code");
        if (address(ledger.settlementToken()) != token) {
            revert PostDeployCheckFailed("settlementToken");
        }
        if (ledger.TOKEN_DECIMALS() != 6) revert PostDeployCheckFailed("TOKEN_DECIMALS");
        if (ledger.MAX_AMOUNT() != 1e18) revert PostDeployCheckFailed("MAX_AMOUNT");
        if (ledger.nextGroupId() != 1) revert PostDeployCheckFailed("nextGroupId");
    }

    function verifyAccount(TallyAccount account_) public view {
        if (address(account_).code.length == 0) revert PostDeployCheckFailed("account code");
        if (
            account_.EXECUTE_TYPEHASH()
                != keccak256(
                    "Execute(bytes32 mode,bytes executionData,uint256 nonce,uint256 deadline)"
                )
        ) revert PostDeployCheckFailed("EXECUTE_TYPEHASH");
        if (account_.nonce() != 0) revert PostDeployCheckFailed("account nonce");
    }

    /// anvil/hardhat default accounts 0-9: their keys are public and must never deploy here.
    function isAnvilDevAccount(address account) public pure returns (bool) {
        return account == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
            || account == 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
            || account == 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
            || account == 0x90F79bf6EB2c4f870365E785982E1f101E93b906
            || account == 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
            || account == 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
            || account == 0x976EA74026E726554dB657fA54763abd0C3a0aa9
            || account == 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955
            || account == 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f
            || account == 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720;
    }
}
