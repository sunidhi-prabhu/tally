// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Vm.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {TallyLedgerBase} from "./TallyLedgerBase.sol";

/// Token-backed settlement with the test-only MockToken. These tests show the ledger's logic is
/// correct for a well-behaved (and several misbehaving) ERC-20s; they say nothing about real AUSD.
contract TokenSettlementTest is TallyLedgerBase {
    uint256 internal groupId;

    /// Snapshot of everything a failed settlement must leave untouched.
    struct State {
        int256 bobNet;
        int256 aliceNet;
        uint256 bobTokens;
        uint256 aliceTokens;
        uint256 ledgerTokens;
        uint256 allowance;
        TallyLedger.SettlementKind kind;
    }

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
        // alice +20, bob -10, carol -10
        _equal(groupId, alice, "e1", 30 * AUSD, _list(alice, bob, carol));
    }

    function _state(bytes32 id) internal view returns (State memory) {
        return State({
            bobNet: _net(groupId, bob),
            aliceNet: _net(groupId, alice),
            bobTokens: token.balanceOf(bob),
            aliceTokens: token.balanceOf(alice),
            ledgerTokens: token.balanceOf(address(ledger)),
            allowance: token.allowance(bob, address(ledger)),
            kind: ledger.settlementKind(groupId, id)
        });
    }

    function _assertUnchanged(State memory before, bytes32 id) internal view {
        State memory afterState = _state(id);
        assertEq(afterState.bobNet, before.bobNet, "bob net");
        assertEq(afterState.aliceNet, before.aliceNet, "alice net");
        assertEq(afterState.bobTokens, before.bobTokens, "bob tokens");
        assertEq(afterState.aliceTokens, before.aliceTokens, "alice tokens");
        assertEq(afterState.ledgerTokens, 0, "ledger holds no tokens");
        assertEq(afterState.allowance, before.allowance, "allowance");
        assertEq(uint8(afterState.kind), uint8(TallyLedger.SettlementKind.None), "not recorded");
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_storesToken() public view {
        assertEq(address(ledger.settlementToken()), address(token));
        assertEq(ledger.TOKEN_DECIMALS(), 6);
    }

    function test_constructor_rejectsInvalidTokens() public {
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvalidToken.selector, address(0)));
        new TallyLedger(address(0));

        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvalidToken.selector, alice));
        new TallyLedger(alice); // no code

        MockToken eighteen = new MockToken(18);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.InvalidToken.selector, address(eighteen))
        );
        new TallyLedger(address(eighteen));

        // A contract without decimals().
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvalidToken.selector, address(ledger)));
        new TallyLedger(address(ledger));
    }

    // ------------------------------------------------------------------ success

    function test_settleWithToken_movesTokensAndUpdatesBalances() public {
        _fund(bob, 4 * AUSD);

        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.SettlementRecorded(
            groupId, "s1", bob, alice, 4 * AUSD, TallyLedger.SettlementKind.TokenTransfer
        );
        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.TokenSettled(groupId, "s1", bob, alice, address(token), 4 * AUSD);
        vm.expectEmit(true, true, false, true, address(token));
        emit MockToken.Transfer(bob, alice, 4 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, 4 * AUSD);

        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(alice), 4 * AUSD);
        assertEq(token.balanceOf(address(ledger)), 0);
        assertEq(token.allowance(bob, address(ledger)), 0);
        assertEq(_net(groupId, bob), -int256(6 * AUSD));
        assertEq(_net(groupId, alice), int256(16 * AUSD));
        assertEq(
            uint8(ledger.settlementKind(groupId, "s1")),
            uint8(TallyLedger.SettlementKind.TokenTransfer)
        );
        assertTrue(ledger.settlementRecorded(groupId, "s1"));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_settleWithToken_fullDebtThenNoMore() public {
        _fund(bob, 20 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, 10 * AUSD);
        assertEq(_net(groupId, bob), 0);

        State memory before = _state("s2");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, 10 * AUSD, 0)
        );
        ledger.settleWithToken(groupId, "s2", alice, 10 * AUSD);
        _assertUnchanged(before, "s2");
    }

    function test_settleWithToken_acceptsTokensWithoutReturnData() public {
        token.setMode(MockToken.Mode.NoReturnData);
        _fund(bob, AUSD);
        _payWithToken(groupId, bob, "s1", alice, AUSD);
        assertEq(token.balanceOf(alice), AUSD);
        assertEq(_net(groupId, bob), -int256(9 * AUSD));
    }

    function test_settleWithToken_aggregateAboveCapInParts() public {
        uint256 max = ledger.MAX_AMOUNT();
        _equal(groupId, dave, "big1", max, _list(carol));
        _equal(groupId, dave, "big2", max, _list(carol));
        _fund(carol, 2 * max);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AmountTooLarge.selector, 2 * max));
        ledger.settleWithToken(groupId, "s1", dave, 2 * max);

        _payWithToken(groupId, carol, "s1", dave, max);
        _payWithToken(groupId, carol, "s2", dave, max);
        assertEq(_net(groupId, dave), 0);
        assertEq(token.balanceOf(dave), 2 * max);
    }

    // ------------------------------------------------------------------ token failures

    function test_revertsOnInsufficientAllowance_stateUnchanged() public {
        token.mint(bob, 10 * AUSD);
        vm.prank(bob);
        token.approve(address(ledger), 3 * AUSD);

        State memory before = _state("s1");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockToken.InsufficientAllowance.selector, address(ledger), 3 * AUSD, 4 * AUSD
            )
        );
        ledger.settleWithToken(groupId, "s1", alice, 4 * AUSD);
        _assertUnchanged(before, "s1");
    }

    function test_revertsOnInsufficientBalance_stateUnchanged() public {
        token.mint(bob, 3 * AUSD);
        vm.prank(bob);
        token.approve(address(ledger), 10 * AUSD);

        State memory before = _state("s1");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MockToken.InsufficientBalance.selector, bob, 3 * AUSD, 4 * AUSD)
        );
        ledger.settleWithToken(groupId, "s1", alice, 4 * AUSD);
        _assertUnchanged(before, "s1");
    }

    function test_revertsWhenTokenReturnsFalse_stateUnchanged() public {
        token.setMode(MockToken.Mode.ReturnsFalse);
        _fund(bob, 4 * AUSD);
        State memory before = _state("s1");
        vm.prank(bob);
        vm.expectRevert(TallyLedger.TokenTransferFailed.selector);
        ledger.settleWithToken(groupId, "s1", alice, 4 * AUSD);
        _assertUnchanged(before, "s1");
    }

    function test_revertsWhenRecipientReceivesLess_stateUnchanged() public {
        token.setMode(MockToken.Mode.FeeOnTransfer);
        _fund(bob, 4 * AUSD);
        State memory before = _state("s1");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.TokenAmountMismatch.selector, 4 * AUSD, 4 * AUSD - 1)
        );
        ledger.settleWithToken(groupId, "s1", alice, 4 * AUSD);
        _assertUnchanged(before, "s1");
    }

    // ------------------------------------------------------------------ validation

    function test_revertsOnInvalidRecipients() public {
        _fund(bob, 10 * AUSD);
        State memory before = _state("s1");
        vm.startPrank(bob);

        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.settleWithToken(groupId, "s1", outsider, AUSD);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, address(0)));
        ledger.settleWithToken(groupId, "s1", address(0), AUSD);
        vm.expectRevert(TallyLedger.SelfSettlement.selector);
        ledger.settleWithToken(groupId, "s1", bob, AUSD);
        // carol is also a debtor; dave has a zero balance.
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.settleWithToken(groupId, "s1", carol, AUSD);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.settleWithToken(groupId, "s1", dave, AUSD);

        vm.stopPrank();
        _assertUnchanged(before, "s1");
    }

    function test_revertsOnInvalidAmountOrId() public {
        _fund(bob, 20 * AUSD);
        uint256 max = ledger.MAX_AMOUNT();
        vm.startPrank(bob);
        vm.expectRevert(TallyLedger.ZeroAmount.selector);
        ledger.settleWithToken(groupId, "s1", alice, 0);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AmountTooLarge.selector, max + 1));
        ledger.settleWithToken(groupId, "s1", alice, max + 1);
        vm.expectRevert(TallyLedger.InvalidId.selector);
        ledger.settleWithToken(groupId, bytes32(0), alice, AUSD);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.settleWithToken(99, "s1", alice, AUSD);
        vm.stopPrank();
    }

    function test_revertsOnOverpayment() public {
        _fund(bob, 20 * AUSD);
        State memory before = _state("s1");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.SettlementExceedsDebt.selector, 10 * AUSD + 1, 10 * AUSD
            )
        );
        ledger.settleWithToken(groupId, "s1", alice, 10 * AUSD + 1);
        _assertUnchanged(before, "s1");
    }

    function test_revertsOnDuplicateIdAcrossBothKinds() public {
        _fund(bob, 10 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, AUSD);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateSettlementId.selector, bytes32("s1"))
        );
        ledger.settleWithToken(groupId, "s1", alice, AUSD);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateSettlementId.selector, bytes32("s1"))
        );
        ledger.acknowledgeSettlement(groupId, "s1", bob, AUSD);

        _acknowledge(groupId, alice, "s2", carol, AUSD);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateSettlementId.selector, bytes32("s2"))
        );
        ledger.settleWithToken(groupId, "s2", alice, AUSD);
        assertEq(token.balanceOf(alice), AUSD, "only the first payment moved tokens");
    }

    // ------------------------------------------------------------------ authorization

    function test_onlyTheCallerEverPays() public {
        // Bob has funds and an unlimited approval, yet nobody else can make him pay.
        token.mint(bob, 100 * AUSD);
        vm.prank(bob);
        token.approve(address(ledger), type(uint256).max);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.settleWithToken(groupId, "s1", alice, AUSD);

        // The creditor calling would mean paying in the wrong direction.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.settleWithToken(groupId, "s1", bob, AUSD);

        // Carol settling her own debt pays from carol, never from bob.
        _fund(carol, AUSD);
        _payWithToken(groupId, carol, "s2", alice, AUSD);
        assertEq(token.balanceOf(bob), 100 * AUSD);
        assertEq(token.balanceOf(carol), 0);
        assertEq(_net(groupId, bob), -int256(10 * AUSD));
    }

    function test_cannotAddLedgerOrTokenAsMember() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvalidMember.selector, address(ledger)));
        ledger.addMember(groupId, address(ledger));
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvalidMember.selector, address(token)));
        ledger.addMember(groupId, address(token));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ reentrancy

    function _assertReentryBlocked(bytes memory reentryCall) internal {
        token.setMode(MockToken.Mode.Reentrant);
        token.setReentry(address(ledger), reentryCall);
        _fund(bob, 4 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, 4 * AUSD);

        assertTrue(token.reentryAttempted(), "token attempted re-entry");
        assertFalse(token.reentrySucceeded(), "re-entry must fail");
        assertEq(token.reentryRevertData(), abi.encodeWithSelector(TallyLedger.Reentrancy.selector));
        // Exactly one settlement applied.
        assertEq(_net(groupId, bob), -int256(6 * AUSD));
        assertEq(token.balanceOf(alice), 4 * AUSD);
        assertFalse(ledger.settlementRecorded(groupId, "s2"));
    }

    function test_reentrancy_settleAgainBlocked() public {
        _assertReentryBlocked(
            abi.encodeCall(TallyLedger.settleWithToken, (groupId, "s2", alice, 4 * AUSD))
        );
    }

    function test_reentrancy_acknowledgeBlocked() public {
        _assertReentryBlocked(
            abi.encodeCall(TallyLedger.acknowledgeSettlement, (groupId, "s2", bob, AUSD))
        );
    }

    function test_reentrancy_expenseBlocked() public {
        _assertReentryBlocked(
            abi.encodeCall(TallyLedger.recordEqualExpense, (groupId, "e2", AUSD, _list(bob), ""))
        );
    }

    function test_reentrancy_viewsSeeUpdatedState() public {
        // Effects happen before the transfer, so a callback reading state sees the new balance.
        token.setMode(MockToken.Mode.Reentrant);
        token.setReentry(address(ledger), abi.encodeCall(TallyLedger.netBalance, (groupId, bob)));
        _fund(bob, 4 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, 4 * AUSD);
        assertTrue(token.reentrySucceeded());
        assertEq(abi.decode(token.reentryRevertData(), (int256)), -int256(6 * AUSD));
    }

    // ------------------------------------------------------------------ kinds stay distinct

    function test_acknowledgementMovesNoTokens_andIsLabelled() public {
        _fund(bob, 10 * AUSD);
        vm.recordLogs();
        _acknowledge(groupId, alice, "s1", bob, 4 * AUSD);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "only SettlementRecorded");
        assertEq(logs[0].emitter, address(ledger));
        assertEq(logs[0].topics[0], TallyLedger.SettlementRecorded.selector);
        assertTrue(logs[0].topics[0] != TallyLedger.TokenSettled.selector);

        assertEq(
            uint8(ledger.settlementKind(groupId, "s1")),
            uint8(TallyLedger.SettlementKind.Acknowledged)
        );
        assertEq(token.balanceOf(bob), 10 * AUSD, "no tokens moved");
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.allowance(bob, address(ledger)), 10 * AUSD);
    }

    function test_mixedKindsShareOneDebt() public {
        _acknowledge(groupId, alice, "s1", bob, 6 * AUSD);
        _fund(bob, 10 * AUSD);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, 5 * AUSD, 4 * AUSD)
        );
        ledger.settleWithToken(groupId, "s2", alice, 5 * AUSD);
        _payWithToken(groupId, bob, "s2", alice, 4 * AUSD);
        assertEq(_net(groupId, bob), 0);
        assertEq(token.balanceOf(alice), 4 * AUSD);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_settleWithToken_outcomes(
        uint256 owed,
        uint256 paid,
        uint256 funded,
        uint256 approved
    ) public {
        uint256 max = ledger.MAX_AMOUNT();
        owed = bound(owed, 1, max);
        paid = bound(paid, 1, max);
        funded = bound(funded, 0, max);
        approved = bound(approved, 0, max);
        _equal(groupId, dave, "debt", owed, _list(carol));
        token.mint(carol, funded);
        vm.prank(carol);
        token.approve(address(ledger), approved);
        uint256 supply = token.totalSupply();

        vm.prank(carol);
        if (paid > owed) {
            vm.expectRevert(
                abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, paid, owed)
            );
        } else if (approved < paid) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    MockToken.InsufficientAllowance.selector, address(ledger), approved, paid
                )
            );
        } else if (funded < paid) {
            vm.expectRevert(
                abi.encodeWithSelector(MockToken.InsufficientBalance.selector, carol, funded, paid)
            );
        }
        ledger.settleWithToken(groupId, "s", dave, paid);

        bool succeeded = paid <= owed && approved >= paid && funded >= paid;
        uint256 moved = succeeded ? paid : 0;
        assertEq(token.balanceOf(carol), funded - moved);
        assertEq(token.balanceOf(dave), moved);
        assertEq(token.balanceOf(address(ledger)), 0);
        assertEq(token.totalSupply(), supply);
        assertEq(_net(groupId, dave), int256(owed - moved));
        assertEq(ledger.settlementRecorded(groupId, "s"), succeeded);
        assertEq(_sumOfBalances(groupId), 0);
    }
}
