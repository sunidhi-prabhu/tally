// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {TallyLedger} from "../../src/TallyLedger.sol";

interface IAusd {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Runs TallyLedger against the real Agora AUSD contract on a LOCAL FORK of Monad
/// testnet. Nothing is broadcast: the fork is simulated in-process, and the test account is
/// funded by impersonating the AUSD faucet inside the fork. This checks the ledger against
/// AUSD's actual bytecode, but it is not a deployment or an on-chain transaction.
///
/// Opt-in: RUN_FORK_TESTS=true MONAD_TESTNET_RPC_URL=<rpc> forge test --match-path 'test/fork/*'
contract AusdForkTest is Test {
    /// Monad testnet AUSD and faucet, from https://docs.agora.finance/developer/contract-deployments
    /// (checked 2026-10-09; on-chain: symbol "AUSD", 6 decimals, EIP-1967 proxy).
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address internal constant AUSD_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    IAusd internal ausd = IAusd(AUSD);
    TallyLedger internal ledger;
    address internal alice = makeAddr("fork-alice");
    address internal bob = makeAddr("fork-bob");
    uint256 internal groupId;

    modifier onlyFork() {
        if (!vm.envOr("RUN_FORK_TESTS", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("MONAD_TESTNET_RPC_URL"));
        _;
    }

    function _setUpGroup(uint256 owed) internal {
        ledger = new TallyLedger(AUSD);
        vm.prank(alice);
        groupId = ledger.createGroup("Fork", _single(bob));
        vm.prank(alice);
        ledger.recordEqualExpense(groupId, "e1", owed, _single(bob), "");
    }

    function _fundFromFaucet(address to, uint256 amount) internal {
        vm.prank(AUSD_FAUCET);
        assertTrue(ausd.transfer(to, amount));
    }

    function _single(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function test_fork_ausdMatchesDocumentedToken() public onlyFork {
        assertEq(block.chainid, MONAD_TESTNET_CHAIN_ID);
        assertGt(AUSD.code.length, 0);
        assertEq(ausd.symbol(), "AUSD");
        assertEq(ausd.decimals(), 6);
        // The constructor's own validation accepts it.
        assertEq(address(new TallyLedger(AUSD).settlementToken()), AUSD);
    }

    function test_fork_settleWithRealAusd() public onlyFork {
        uint256 owed = 25e6;
        _setUpGroup(owed);
        _fundFromFaucet(bob, owed);
        uint256 aliceBefore = ausd.balanceOf(alice);

        vm.prank(bob);
        ausd.approve(address(ledger), owed);
        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.TokenSettled(groupId, "s1", bob, alice, AUSD, owed);
        vm.prank(bob);
        ledger.settleWithToken(groupId, "s1", alice, owed);

        assertEq(ausd.balanceOf(alice) - aliceBefore, owed);
        assertEq(ausd.balanceOf(bob), 0);
        assertEq(ausd.balanceOf(address(ledger)), 0);
        assertEq(ausd.allowance(bob, address(ledger)), 0);
        assertEq(ledger.netBalance(groupId, bob), 0);
        assertEq(
            uint8(ledger.settlementKind(groupId, "s1")),
            uint8(TallyLedger.SettlementKind.TokenTransfer)
        );
    }

    function test_fork_realAusdFailuresLeaveStateUnchanged() public onlyFork {
        uint256 owed = 10e6;
        _setUpGroup(owed);
        _fundFromFaucet(bob, owed / 2);

        // Insufficient allowance.
        vm.prank(bob);
        ausd.approve(address(ledger), 1e6);
        vm.prank(bob);
        vm.expectRevert();
        ledger.settleWithToken(groupId, "s1", alice, 2e6);

        // Insufficient balance.
        vm.prank(bob);
        ausd.approve(address(ledger), owed);
        vm.prank(bob);
        vm.expectRevert();
        ledger.settleWithToken(groupId, "s1", alice, owed);

        assertEq(ledger.netBalance(groupId, bob), -int256(owed));
        assertFalse(ledger.settlementRecorded(groupId, "s1"));
        assertEq(ausd.balanceOf(bob), owed / 2);
        assertEq(ausd.balanceOf(alice), 0);
    }
}
