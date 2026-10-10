// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {DeployTallyLedgerTestnet} from "../script/DeployTallyLedgerTestnet.s.sol";

/// Test-only stand-in with AUSD's metadata, etched at the testnet AUSD address.
contract AusdLike {
    string public symbol;
    uint8 public decimals;

    constructor(string memory symbol_, uint8 decimals_) {
        symbol = symbol_;
        decimals = decimals_;
    }
}

/// Exercises the deploy script's fail-closed checks locally. Nothing here touches a network.
contract DeployTallyLedgerTestnetTest is Test {
    DeployTallyLedgerTestnet internal script;
    address internal ausd;
    address internal deployer = makeAddr("deployer");

    function setUp() public {
        script = new DeployTallyLedgerTestnet();
        ausd = script.MONAD_TESTNET_AUSD();
        vm.chainId(10143);
        _etchToken("AUSD", 6);
    }

    function _etchToken(string memory symbol, uint8 decimals) internal {
        AusdLike token = new AusdLike(symbol, decimals);
        vm.etch(ausd, address(token).code);
        // Copy storage (symbol, decimals) so the etched code reads the same values.
        vm.store(ausd, bytes32(uint256(0)), vm.load(address(token), bytes32(uint256(0))));
        vm.store(ausd, bytes32(uint256(1)), vm.load(address(token), bytes32(uint256(1))));
    }

    function test_deploysWithVerifiedToken() public {
        // Called directly: the sender is this test contract (not a dev or placeholder account).
        TallyLedger ledger = script.deploy(ausd);
        assertEq(address(ledger.settlementToken()), ausd);
        assertEq(ledger.nextGroupId(), 1);
        assertGt(address(ledger).code.length, 0);
    }

    function test_rejectsOtherChains() public {
        for (uint256 i = 0; i < 3; ++i) {
            uint256 chainId = [uint256(143), 31337, 1][i];
            vm.chainId(chainId);
            vm.prank(deployer);
            vm.expectRevert(
                abi.encodeWithSelector(DeployTallyLedgerTestnet.WrongChain.selector, 10143, chainId)
            );
            script.deploy(ausd);
        }
    }

    function test_rejectsMainnetAusd() public {
        address mainnet = script.MONAD_MAINNET_AUSD();
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTallyLedgerTestnet.MainnetTokenRejected.selector, mainnet)
        );
        script.deploy(mainnet);
    }

    function test_rejectsAnyOtherToken() public {
        address other = makeAddr("other-token");
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTallyLedgerTestnet.UnexpectedToken.selector, ausd, other)
        );
        script.deploy(other);
    }

    function test_rejectsTokenWithoutCode() public {
        vm.etch(ausd, "");
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(DeployTallyLedgerTestnet.TokenHasNoCode.selector, ausd)
        );
        script.deploy(ausd);
    }

    function test_rejectsWrongMetadata() public {
        _etchToken("AUSD", 18);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployTallyLedgerTestnet.UnexpectedTokenMetadata.selector, "AUSD", uint8(18)
            )
        );
        script.deploy(ausd);

        _etchToken("USDC", 6);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployTallyLedgerTestnet.UnexpectedTokenMetadata.selector, "USDC", uint8(6)
            )
        );
        script.deploy(ausd);
    }

    function test_rejectsMissingOrDevelopmentSender() public {
        vm.expectRevert(DeployTallyLedgerTestnet.MissingSender.selector);
        script.validate(ausd, 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38);
        vm.expectRevert(DeployTallyLedgerTestnet.MissingSender.selector);
        script.validate(ausd, address(0));

        address anvil0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployTallyLedgerTestnet.DevelopmentAccountRejected.selector, anvil0
            )
        );
        script.validate(ausd, anvil0);
        script.validate(ausd, deployer); // a normal account passes
    }

    /// The only test that touches the (process-wide) environment.
    function test_runReadsTokenFromEnvironmentAndFailsWithoutIt() public {
        vm.setEnv("AUSD_ADDRESS", vm.toString(ausd));
        assertEq(address(script.run().settlementToken()), ausd);

        vm.setEnv("AUSD_ADDRESS", "");
        vm.prank(deployer);
        vm.expectRevert();
        script.run();
    }
}
