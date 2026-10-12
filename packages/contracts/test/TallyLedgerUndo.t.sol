// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TallyLedger} from "../src/TallyLedger.sol";
import {TallyLedgerBase} from "./TallyLedgerBase.sol";

/// @dev undoExpense: exact reversal, authorization, detail matching and membership rules.
contract TallyLedgerUndoTest is TallyLedgerBase {
    uint256 internal groupId;

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
    }

    /// Records an equal split and returns the details `undoExpense` needs.
    function _recordEqual(address payer, bytes32 id, uint256 amount, address[] memory list)
        internal
        returns (address[] memory participants, uint256[] memory shares)
    {
        participants = _sorted(list);
        _equal(groupId, payer, id, amount, participants);
        uint256 count = participants.length;
        shares = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            shares[i] = amount / count + (i < amount % count ? 1 : 0);
        }
    }

    function _undo(
        address caller,
        bytes32 id,
        address payer,
        uint256 amount,
        address[] memory participants,
        uint256[] memory shares
    ) internal {
        vm.prank(caller);
        ledger.undoExpense(groupId, id, payer, amount, participants, shares);
    }

    function test_undo_byPayer_restoresBalancesExactly() public {
        _equal(groupId, bob, "before", 7 * AUSD, _list(alice, bob));
        int256 aliceBefore = _net(groupId, alice);
        int256 bobBefore = _net(groupId, bob);

        // 10 AUSD / 3 leaves a remainder, so the shares are uneven.
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 10 * AUSD, _list(alice, bob, carol));
        assertTrue(_net(groupId, alice) != aliceBefore);

        vm.expectEmit(address(ledger));
        emit TallyLedger.ExpenseUndone(groupId, "e1", alice);
        _undo(alice, "e1", alice, 10 * AUSD, p, s);

        assertEq(_net(groupId, alice), aliceBefore);
        assertEq(_net(groupId, bob), bobBefore);
        assertEq(_net(groupId, carol), 0);
        assertEq(_sumOfBalances(groupId), 0);
        assertEq(
            uint8(ledger.expenseStatus(groupId, "e1")), uint8(TallyLedger.ExpenseStatus.Undone)
        );
        assertTrue(ledger.expenseRecorded(groupId, "e1"));
    }

    function test_undo_customSplit_byAdmin() public {
        (address[] memory p, uint256[] memory s) =
            _sortedPairs(_list(alice, carol), _amounts(4 * AUSD, 6 * AUSD));
        vm.prank(bob);
        ledger.recordCustomExpense(groupId, "e1", 10 * AUSD, p, s, "Taxi");
        assertEq(_net(groupId, bob), int256(10 * AUSD));

        // alice is the admin but neither payer nor the only participant.
        _undo(alice, "e1", bob, 10 * AUSD, p, s);
        assertEq(_net(groupId, alice), 0);
        assertEq(_net(groupId, bob), 0);
        assertEq(_net(groupId, carol), 0);
    }

    function test_undo_otherMember_reverts() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(bob, "e1", 10 * AUSD, _list(bob, carol));
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.NotAllowedToUndo.selector, groupId, carol)
        );
        _undo(carol, "e1", bob, 10 * AUSD, p, s);
    }

    function test_undo_outsider_reverts() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(bob, "e1", 10 * AUSD, _list(bob, carol));
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.NotAllowedToUndo.selector, groupId, outsider)
        );
        _undo(outsider, "e1", bob, 10 * AUSD, p, s);
    }

    function test_undo_twice_reverts() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 10 * AUSD, _list(alice, bob));
        _undo(alice, "e1", alice, 10 * AUSD, p, s);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.ExpenseNotActive.selector, bytes32("e1"))
        );
        _undo(alice, "e1", alice, 10 * AUSD, p, s);
    }

    function test_undo_unknownExpense_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.ExpenseNotActive.selector, bytes32("nope"))
        );
        _undo(alice, "nope", alice, 1, _list(alice), _amounts(1));
    }

    function test_undo_unknownGroup_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 999));
        ledger.undoExpense(999, "e1", alice, 1, _list(alice), _amounts(1));
    }

    function test_undo_wrongDetails_reverts() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 10 * AUSD, _list(alice, bob));
        bytes memory mismatch =
            abi.encodeWithSelector(TallyLedger.ExpenseDetailsMismatch.selector, bytes32("e1"));

        // Wrong amount.
        vm.expectRevert(mismatch);
        _undo(alice, "e1", alice, 11 * AUSD, p, s);
        // Shifted shares (same total).
        uint256[] memory shifted = _amounts(s[0] + 1, s[1] - 1);
        vm.expectRevert(mismatch);
        _undo(alice, "e1", alice, 10 * AUSD, p, shifted);
        // Wrong payer, even when called by the admin.
        vm.expectRevert(mismatch);
        _undo(alice, "e1", bob, 10 * AUSD, p, s);
        // Different participants.
        vm.expectRevert(mismatch);
        _undo(alice, "e1", alice, 10 * AUSD, _sorted(_list(alice, carol)), s);

        assertEq(
            uint8(ledger.expenseStatus(groupId, "e1")), uint8(TallyLedger.ExpenseStatus.Active)
        );
    }

    function test_undo_afterParticipantLeft_reverts_untilReAdded() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 10 * AUSD, _list(alice, dave));
        // dave clears his 5 AUSD debt, then leaves.
        _acknowledge(groupId, alice, "s1", dave, 5 * AUSD);
        vm.prank(dave);
        ledger.leaveGroup(groupId);

        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, dave));
        _undo(alice, "e1", alice, 10 * AUSD, p, s);

        vm.prank(alice);
        ledger.addMember(groupId, dave);
        _undo(alice, "e1", alice, 10 * AUSD, p, s);
        // dave had paid 5 for an expense that no longer counts, so alice now owes him 5.
        assertEq(_net(groupId, dave), int256(5 * AUSD));
        assertEq(_net(groupId, alice), -int256(5 * AUSD));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_undo_afterTokenSettlement_reversesDirection() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 30 * AUSD, _list(alice, bob));
        _fund(bob, 15 * AUSD);
        _payWithToken(groupId, bob, "s1", alice, 15 * AUSD);
        assertEq(_net(groupId, bob), 0);

        _undo(alice, "e1", alice, 30 * AUSD, p, s);
        assertEq(_net(groupId, bob), int256(15 * AUSD));
        assertEq(_net(groupId, alice), -int256(15 * AUSD));
        // The tokens stay where they were paid; only the accounting changes.
        assertEq(token.balanceOf(alice), 15 * AUSD);
    }

    function test_undone_id_cannotBeReused() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(alice, "e1", 10 * AUSD, _list(alice, bob));
        _undo(alice, "e1", alice, 10 * AUSD, p, s);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateExpenseId.selector, bytes32("e1"))
        );
        ledger.recordEqualExpense(groupId, "e1", 10 * AUSD, p, "");
    }

    function test_expenseHash_matchesRecordedDetails() public {
        (address[] memory p, uint256[] memory s) =
            _recordEqual(bob, "e1", 10 * AUSD, _list(alice, bob, carol));
        assertEq(ledger.expenseHash(groupId, "e1"), keccak256(abi.encode(bob, 10 * AUSD, p, s)));
    }
}
