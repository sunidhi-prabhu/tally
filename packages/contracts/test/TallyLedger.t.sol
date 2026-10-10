// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TallyLedger} from "../src/TallyLedger.sol";
import {TallyLedgerBase} from "./TallyLedgerBase.sol";

contract GroupTest is TallyLedgerBase {
    function test_createGroup_setsAdminMembersAndEvents() public {
        vm.expectEmit(true, true, false, true, address(ledger));
        emit TallyLedger.GroupCreated(1, alice, "Trip");
        vm.expectEmit(true, true, true, false, address(ledger));
        emit TallyLedger.MemberAdded(1, alice, alice);
        vm.expectEmit(true, true, true, false, address(ledger));
        emit TallyLedger.MemberAdded(1, bob, alice);

        vm.prank(alice);
        uint256 groupId = ledger.createGroup("Trip", _list(bob));

        assertEq(groupId, 1);
        assertEq(ledger.nextGroupId(), 2);
        (address admin, uint256 memberCount) = ledger.getGroup(groupId);
        assertEq(admin, alice);
        assertEq(memberCount, 2);
        assertTrue(ledger.groupExists(groupId));
        assertTrue(ledger.isMember(groupId, alice));
        assertTrue(ledger.isMember(groupId, bob));
        assertFalse(ledger.isMember(groupId, carol));
    }

    function test_createGroup_assignsSequentialIds() public {
        vm.prank(alice);
        assertEq(ledger.createGroup("A", new address[](0)), 1);
        vm.prank(bob);
        assertEq(ledger.createGroup("B", new address[](0)), 2);
        (address admin,) = ledger.getGroup(2);
        assertEq(admin, bob);
        assertFalse(ledger.groupExists(3));
    }

    function test_createGroup_acceptsMaxLengthName() public {
        vm.prank(alice);
        ledger.createGroup(string(new bytes(64)), new address[](0));
    }

    function test_createGroup_revertsOnInvalidName() public {
        vm.startPrank(alice);
        vm.expectRevert(TallyLedger.InvalidName.selector);
        ledger.createGroup("", new address[](0));
        vm.expectRevert(TallyLedger.InvalidName.selector);
        ledger.createGroup(string(new bytes(65)), new address[](0));
        vm.stopPrank();
    }

    function test_createGroup_revertsOnZeroAddressMember() public {
        vm.prank(alice);
        vm.expectRevert(TallyLedger.ZeroAddress.selector);
        ledger.createGroup("Trip", _list(bob, address(0)));
    }

    function test_createGroup_revertsOnDuplicateMembers() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AlreadyMember.selector, 1, bob));
        ledger.createGroup("Trip", _list(bob, bob));
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AlreadyMember.selector, 1, alice));
        ledger.createGroup("Trip", _list(alice));
        vm.stopPrank();
        // A reverted creation does not consume the group ID.
        assertEq(ledger.nextGroupId(), 1);
    }

    function test_createGroup_enforcesMemberCap() public {
        address[] memory others = new address[](99);
        for (uint256 i = 0; i < others.length; ++i) {
            others[i] = address(uint160(0x1000 + i));
        }
        vm.prank(alice);
        uint256 groupId = ledger.createGroup("Full", others);
        (, uint256 memberCount) = ledger.getGroup(groupId);
        assertEq(memberCount, 100);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.TooManyMembers.selector, groupId));
        ledger.addMember(groupId, bob);

        address[] memory tooMany = new address[](100);
        for (uint256 i = 0; i < tooMany.length; ++i) {
            tooMany[i] = address(uint160(0x2000 + i));
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.TooManyMembers.selector, groupId + 1));
        ledger.createGroup("Too many", tooMany);
    }
}

contract MembershipTest is TallyLedgerBase {
    uint256 internal groupId;

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
    }

    function test_addMember_byAdmin() public {
        vm.expectEmit(true, true, true, false, address(ledger));
        emit TallyLedger.MemberAdded(groupId, outsider, alice);
        vm.prank(alice);
        ledger.addMember(groupId, outsider);
        assertTrue(ledger.isMember(groupId, outsider));
        assertEq(_net(groupId, outsider), 0);
    }

    function test_addMember_revertsForNonAdmins() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotGroupAdmin.selector, groupId, bob));
        ledger.addMember(groupId, outsider);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.NotGroupAdmin.selector, groupId, outsider)
        );
        ledger.addMember(groupId, outsider);
    }

    function test_addMember_revertsOnInvalidInput() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.addMember(99, outsider);
        vm.expectRevert(TallyLedger.ZeroAddress.selector);
        ledger.addMember(groupId, address(0));
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AlreadyMember.selector, groupId, bob));
        ledger.addMember(groupId, bob);
        vm.stopPrank();
    }

    function test_removeMember_withZeroBalance() public {
        vm.expectEmit(true, true, true, false, address(ledger));
        emit TallyLedger.MemberRemoved(groupId, bob, alice);
        vm.prank(alice);
        ledger.removeMember(groupId, bob);

        assertFalse(ledger.isMember(groupId, bob));
        address[] memory members = ledger.getMembers(groupId);
        assertEq(members.length, 3);
        for (uint256 i = 0; i < members.length; ++i) {
            assertTrue(members[i] != bob);
            assertTrue(ledger.isMember(groupId, members[i]));
        }
        (, uint256 memberCount) = ledger.getGroup(groupId);
        assertEq(memberCount, 3);
    }

    function test_removeMember_revertsWhileBalanceOutstanding() public {
        _equal(groupId, bob, "e1", 30 * AUSD, _list(bob, carol, dave));

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.OutstandingBalance.selector, groupId, carol, -int256(10 * AUSD)
            )
        );
        ledger.removeMember(groupId, carol);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.OutstandingBalance.selector, groupId, bob, int256(20 * AUSD)
            )
        );
        ledger.removeMember(groupId, bob);
        vm.stopPrank();

        _acknowledge(groupId, bob, "s1", carol, 10 * AUSD);
        vm.prank(alice);
        ledger.removeMember(groupId, carol);
        assertFalse(ledger.isMember(groupId, carol));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_removeMember_revertsForNonAdminOrInvalidTarget() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotGroupAdmin.selector, groupId, bob));
        ledger.removeMember(groupId, carol);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.removeMember(groupId, outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AdminCannotBeRemoved.selector, groupId));
        ledger.removeMember(groupId, alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.removeMember(99, bob);
        vm.stopPrank();
    }

    function test_leaveGroup() public {
        vm.expectEmit(true, true, true, false, address(ledger));
        emit TallyLedger.MemberRemoved(groupId, dave, dave);
        vm.prank(dave);
        ledger.leaveGroup(groupId);
        assertFalse(ledger.isMember(groupId, dave));
    }

    function test_leaveGroup_reverts() public {
        _equal(groupId, bob, "e1", 10 * AUSD, _list(carol));

        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.OutstandingBalance.selector, groupId, carol, -int256(10 * AUSD)
            )
        );
        ledger.leaveGroup(groupId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AdminCannotBeRemoved.selector, groupId));
        ledger.leaveGroup(groupId);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.leaveGroup(groupId);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.leaveGroup(99);
    }

    function test_removedMember_cannotParticipateOrRecord_untilReAdded() public {
        vm.prank(alice);
        ledger.removeMember(groupId, dave);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, dave));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(dave), "");

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, dave));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob), "");

        vm.prank(alice);
        ledger.addMember(groupId, dave);
        assertEq(_net(groupId, dave), 0);
        _equal(groupId, bob, "e1", AUSD, _list(dave));
        assertEq(_net(groupId, dave), -int256(AUSD));
    }
}

contract ExpenseTest is TallyLedgerBase {
    uint256 internal groupId;

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
    }

    function test_equal_payerParticipates_doesNotOweThemselves() public {
        address[] memory participants = _sorted(_list(alice, bob, carol));
        uint256[] memory shares = new uint256[](3);
        shares[0] = 10 * AUSD;
        shares[1] = 10 * AUSD;
        shares[2] = 10 * AUSD;

        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.ExpenseRecorded(
            groupId,
            "e1",
            alice,
            30 * AUSD,
            TallyLedger.SplitType.Equal,
            participants,
            shares,
            "Dinner"
        );
        vm.prank(alice);
        ledger.recordEqualExpense(groupId, "e1", 30 * AUSD, participants, "Dinner");

        assertEq(_net(groupId, alice), int256(20 * AUSD));
        assertEq(_net(groupId, bob), -int256(10 * AUSD));
        assertEq(_net(groupId, carol), -int256(10 * AUSD));
        assertEq(_net(groupId, dave), 0);
        assertEq(_sumOfBalances(groupId), 0);
        assertTrue(ledger.expenseRecorded(groupId, "e1"));
    }

    function test_equal_payerOnlyForOthers() public {
        _equal(groupId, alice, "e1", 30 * AUSD, _list(bob, carol));
        assertEq(_net(groupId, alice), int256(30 * AUSD));
        assertEq(_net(groupId, bob), -int256(15 * AUSD));
        assertEq(_net(groupId, carol), -int256(15 * AUSD));
    }

    function test_equal_payerIsSoleParticipant_changesNothing() public {
        _equal(groupId, alice, "e1", 30 * AUSD, _list(alice));
        assertEq(_net(groupId, alice), 0);
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_equal_remainderGoesToLowestAddresses() public {
        address[] memory participants = _sorted(_list(alice, bob, carol));
        // 10 AUSD / 3: 3_333_334 to the lowest address, 3_333_333 to the others.
        _equal(groupId, dave, "e1", 10 * AUSD, participants);
        assertEq(_net(groupId, participants[0]), -3_333_334);
        assertEq(_net(groupId, participants[1]), -3_333_333);
        assertEq(_net(groupId, participants[2]), -3_333_333);
        assertEq(_net(groupId, dave), int256(10 * AUSD));
    }

    function test_equal_amountBelowParticipantCount_givesZeroShares() public {
        address[] memory participants = _sorted(_list(alice, bob, carol));
        _equal(groupId, dave, "e1", 2, participants);
        assertEq(_net(groupId, participants[0]), -1);
        assertEq(_net(groupId, participants[1]), -1);
        assertEq(_net(groupId, participants[2]), 0);
    }

    function test_custom_recordsSharesIncludingZero() public {
        (address[] memory participants, uint256[] memory shares) =
            _sortedPairs(_list(bob, carol, dave), _amountsOf3(7 * AUSD, 3 * AUSD, 0));
        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.ExpenseRecorded(
            groupId, "e1", alice, 10 * AUSD, TallyLedger.SplitType.Custom, participants, shares, ""
        );
        vm.prank(alice);
        ledger.recordCustomExpense(groupId, "e1", 10 * AUSD, participants, shares, "");

        assertEq(_net(groupId, alice), int256(10 * AUSD));
        assertEq(_net(groupId, bob), -int256(7 * AUSD));
        assertEq(_net(groupId, carol), -int256(3 * AUSD));
        assertEq(_net(groupId, dave), 0);
    }

    function test_custom_revertsOnShareTotalMismatch() public {
        (address[] memory participants,) = _sortedPairs(_list(bob, carol), _amounts(0, 0));
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.ShareTotalMismatch.selector, 10 * AUSD, 9 * AUSD)
        );
        ledger.recordCustomExpense(
            groupId, "e1", 10 * AUSD, participants, _amounts(5 * AUSD, 4 * AUSD), ""
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.ShareTotalMismatch.selector, 10 * AUSD, 10 * AUSD + 1
            )
        );
        ledger.recordCustomExpense(
            groupId, "e1", 10 * AUSD, participants, _amounts(5 * AUSD, 5 * AUSD + 1), ""
        );
        vm.stopPrank();
    }

    function test_custom_revertsOnOversizedShare_withoutOverflow() public {
        (address[] memory participants,) = _sortedPairs(_list(bob, carol), _amounts(0, 0));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.ShareTotalMismatch.selector, 10 * AUSD, type(uint256).max
            )
        );
        ledger.recordCustomExpense(
            groupId, "e1", 10 * AUSD, participants, _amounts(type(uint256).max, 2), ""
        );
    }

    function test_custom_revertsOnLengthMismatch() public {
        vm.prank(alice);
        vm.expectRevert(TallyLedger.LengthMismatch.selector);
        ledger.recordCustomExpense(
            groupId, "e1", 10 * AUSD, _sorted(_list(bob, carol)), _amounts(10 * AUSD), ""
        );
    }

    function test_revertsWhenCallerIsNotMember() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob), "");
    }

    function test_revertsOnUnknownGroup() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.recordEqualExpense(99, "e1", AUSD, _list(bob), "");
    }

    function test_revertsOnInvalidOrDuplicateId() public {
        vm.startPrank(alice);
        vm.expectRevert(TallyLedger.InvalidId.selector);
        ledger.recordEqualExpense(groupId, bytes32(0), AUSD, _list(bob), "");

        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob), "");
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateExpenseId.selector, bytes32("e1"))
        );
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob), "");
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateExpenseId.selector, bytes32("e1"))
        );
        ledger.recordCustomExpense(groupId, "e1", AUSD, _list(bob), _amounts(AUSD), "");

        // IDs are scoped per group.
        uint256 other = ledger.createGroup("Other", _list(bob));
        ledger.recordEqualExpense(other, "e1", AUSD, _list(bob), "");
        vm.stopPrank();
        assertEq(_net(groupId, bob), -int256(AUSD));
        assertEq(_net(other, bob), -int256(AUSD));
    }

    function test_revertsOnZeroOrExcessiveAmount() public {
        uint256 max = ledger.MAX_AMOUNT();
        assertEq(max, 1e18);
        vm.startPrank(alice);
        vm.expectRevert(TallyLedger.ZeroAmount.selector);
        ledger.recordEqualExpense(groupId, "e1", 0, _list(bob), "");
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AmountTooLarge.selector, max + 1));
        ledger.recordEqualExpense(groupId, "e1", max + 1, _list(bob), "");
        vm.expectRevert(TallyLedger.ZeroAmount.selector);
        ledger.recordCustomExpense(groupId, "e1", 0, _list(bob), _amounts(0), "");

        ledger.recordEqualExpense(groupId, "e1", max, _list(bob), "");
        vm.stopPrank();
        assertEq(_net(groupId, bob), -int256(max));
    }

    function test_revertsOnInvalidParticipants() public {
        address[] memory sortedPair = _sorted(_list(bob, carol));
        address[] memory unsorted = _list(sortedPair[1], sortedPair[0]);

        vm.startPrank(alice);
        vm.expectRevert(TallyLedger.EmptyParticipants.selector);
        ledger.recordEqualExpense(groupId, "e1", AUSD, new address[](0), "");
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.DuplicateParticipant.selector, bob));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob, bob), "");
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.DuplicateParticipant.selector, bob));
        ledger.recordCustomExpense(groupId, "e1", AUSD, _list(bob, bob), _amounts(AUSD, 0), "");
        vm.expectRevert(TallyLedger.ParticipantsNotSorted.selector);
        ledger.recordEqualExpense(groupId, "e1", AUSD, unsorted, "");
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(outsider), "");
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, address(0)));
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(address(0)), "");
        vm.stopPrank();

        assertFalse(ledger.expenseRecorded(groupId, "e1"));
        assertEq(_net(groupId, alice), 0);
    }

    function test_descriptionLengthLimit() public {
        vm.startPrank(alice);
        ledger.recordEqualExpense(groupId, "e1", AUSD, _list(bob), string(new bytes(280)));
        vm.expectRevert(TallyLedger.DescriptionTooLong.selector);
        ledger.recordEqualExpense(groupId, "e2", AUSD, _list(bob), string(new bytes(281)));
        vm.stopPrank();
    }

    function test_multipleExpenses_conserveBalances() public {
        _equal(groupId, alice, "e1", 30 * AUSD, _list(alice, bob, carol));
        _equal(groupId, bob, "e2", 12 * AUSD, _list(alice, bob, carol));
        _equal(groupId, dave, "e3", 7, _list(alice, bob, carol));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function _amountsOf3(uint256 a, uint256 b, uint256 c)
        internal
        pure
        returns (uint256[] memory out)
    {
        out = new uint256[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }
}

contract SettlementTest is TallyLedgerBase {
    uint256 internal groupId;

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
        // alice +20, bob -10, carol -10
        _equal(groupId, alice, "e1", 30 * AUSD, _list(alice, bob, carol));
    }

    function test_acknowledge_partialThenFull() public {
        vm.expectEmit(true, true, true, true, address(ledger));
        emit TallyLedger.SettlementRecorded(
            groupId, "s1", bob, alice, 4 * AUSD, TallyLedger.SettlementKind.Acknowledged
        );
        _acknowledge(groupId, alice, "s1", bob, 4 * AUSD);

        assertEq(_net(groupId, alice), int256(16 * AUSD));
        assertEq(_net(groupId, bob), -int256(6 * AUSD));
        assertTrue(ledger.settlementRecorded(groupId, "s1"));
        assertEq(ledger.maxSettleable(groupId, bob, alice), 6 * AUSD);

        _acknowledge(groupId, alice, "s2", bob, 6 * AUSD);
        assertEq(_net(groupId, bob), 0);
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_acknowledge_revertsOnReplayedId() public {
        _acknowledge(groupId, alice, "s1", bob, AUSD);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.DuplicateSettlementId.selector, bytes32("s1"))
        );
        ledger.acknowledgeSettlement(groupId, "s1", bob, AUSD);
        assertEq(_net(groupId, bob), -int256(9 * AUSD));
    }

    function test_acknowledge_cannotClearDebtTwice() public {
        _acknowledge(groupId, alice, "s1", bob, 10 * AUSD);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, 10 * AUSD, 0)
        );
        ledger.acknowledgeSettlement(groupId, "s2", bob, 10 * AUSD);
    }

    function test_acknowledge_revertsOnOverpayment() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TallyLedger.SettlementExceedsDebt.selector, 10 * AUSD + 1, 10 * AUSD
            )
        );
        ledger.acknowledgeSettlement(groupId, "s1", bob, 10 * AUSD + 1);
    }

    function test_acknowledge_revertsOnWrongDirection() public {
        // A debtor cannot acknowledge "receiving" from the creditor.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.acknowledgeSettlement(groupId, "s1", alice, AUSD);

        // Between two debtors there is nothing to settle.
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.acknowledgeSettlement(groupId, "s1", bob, AUSD);

        // A member with a zero balance cannot be paid.
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, AUSD, 0));
        ledger.acknowledgeSettlement(groupId, "s1", bob, AUSD);
    }

    function test_acknowledge_revertsOnInvalidInput() public {
        vm.startPrank(alice);
        vm.expectRevert(TallyLedger.SelfSettlement.selector);
        ledger.acknowledgeSettlement(groupId, "s1", alice, AUSD);
        vm.expectRevert(TallyLedger.ZeroAmount.selector);
        ledger.acknowledgeSettlement(groupId, "s1", bob, 0);
        vm.expectRevert(TallyLedger.InvalidId.selector);
        ledger.acknowledgeSettlement(groupId, bytes32(0), bob, AUSD);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.acknowledgeSettlement(groupId, "s1", outsider, AUSD);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 99));
        ledger.acknowledgeSettlement(99, "s1", bob, AUSD);
        vm.stopPrank();

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotMember.selector, groupId, outsider));
        ledger.acknowledgeSettlement(groupId, "s1", bob, AUSD);
    }

    function test_maxSettleable() public view {
        assertEq(ledger.maxSettleable(groupId, bob, alice), 10 * AUSD);
        assertEq(ledger.maxSettleable(groupId, alice, bob), 0);
        assertEq(ledger.maxSettleable(groupId, bob, carol), 0);
        assertEq(ledger.maxSettleable(groupId, bob, bob), 0);
        assertEq(ledger.maxSettleable(groupId, bob, outsider), 0);
    }

    function test_aggregateBalanceAboveCap_mustBeSettledInParts() public {
        uint256 max = ledger.MAX_AMOUNT();
        _equal(groupId, dave, "big1", max, _list(carol));
        _equal(groupId, dave, "big2", max, _list(carol));
        assertEq(_net(groupId, dave), int256(2 * max));
        assertEq(ledger.maxSettleable(groupId, carol, dave), 2 * max);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AmountTooLarge.selector, 2 * max));
        ledger.acknowledgeSettlement(groupId, "s1", carol, 2 * max);

        _acknowledge(groupId, dave, "s1", carol, max);
        _acknowledge(groupId, dave, "s2", carol, max);
        assertEq(_net(groupId, dave), 0);
        assertEq(_net(groupId, carol), -int256(10 * AUSD));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function test_settlementIsNotATokenTransfer() public {
        uint256 balanceBefore = address(ledger).balance;
        _acknowledge(groupId, alice, "s1", bob, AUSD);
        // Only an accounting record: the contract holds no value and calls no token.
        assertEq(address(ledger).balance, balanceBefore);
    }
}
