// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TallyLedger} from "../src/TallyLedger.sol";
import {TallyLedgerBase} from "./TallyLedgerBase.sol";

contract TallyLedgerFuzzTest is TallyLedgerBase {
    uint256 internal constant MAX_PARTICIPANTS = 20;

    /// Group of `count` participants (sorted) plus a separate payer.
    function _groupWith(uint256 count)
        internal
        returns (uint256 groupId, address payer, address[] memory participants)
    {
        payer = makeAddr("payer");
        participants = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            participants[i] = makeAddr(string.concat("member", vm.toString(i)));
        }
        participants = _sorted(participants);
        vm.prank(payer);
        groupId = ledger.createGroup("Fuzz", participants);
    }

    function testFuzz_equalSplit_allocatesEveryUnitToLowestAddressesFirst(
        uint256 amount,
        uint256 count
    ) public {
        amount = bound(amount, 1, ledger.MAX_AMOUNT());
        count = bound(count, 1, MAX_PARTICIPANTS);
        (uint256 groupId, address payer, address[] memory participants) = _groupWith(count);

        vm.prank(payer);
        ledger.recordEqualExpense(groupId, "e", amount, participants, "");

        uint256 base = amount / count;
        uint256 remainder = amount % count;
        uint256 total = 0;
        for (uint256 i = 0; i < count; ++i) {
            uint256 share = uint256(-_net(groupId, participants[i]));
            assertEq(share, i < remainder ? base + 1 : base, "share follows address order");
            total += share;
        }
        assertEq(total, amount, "every unit allocated");
        assertEq(_net(groupId, payer), int256(amount));
        assertEq(_sumOfBalances(groupId), 0);
    }

    function testFuzz_equalSplit_payerParticipating(uint256 amount, uint256 count) public {
        amount = bound(amount, 1, ledger.MAX_AMOUNT());
        count = bound(count, 1, MAX_PARTICIPANTS);
        (uint256 groupId,, address[] memory participants) = _groupWith(count);
        address payer = participants[count / 2];

        vm.prank(payer);
        ledger.recordEqualExpense(groupId, "e", amount, participants, "");

        uint256 ownShare = amount / count + ((count / 2) < (amount % count) ? 1 : 0);
        assertEq(_net(groupId, payer), int256(amount - ownShare), "payer nets amount - own share");
        assertEq(_sumOfBalances(groupId), 0);
    }

    function testFuzz_customSplit_acceptsOnlyExactTotals(uint256 amount, uint256 cut, int256 skew)
        public
    {
        amount = bound(amount, 1, ledger.MAX_AMOUNT());
        cut = bound(cut, 0, amount);
        skew = bound(skew, -1e6, 1e6);
        (uint256 groupId, address payer, address[] memory participants) = _groupWith(2);

        uint256 second = amount - cut;
        if (skew < 0 && uint256(-skew) > second) skew = 0;
        // forge-lint: disable-next-line(unsafe-typecast) bounded above
        uint256 skewed = skew < 0 ? second - uint256(-skew) : second + uint256(skew);
        uint256[] memory shares = _amounts(cut, skewed);

        vm.prank(payer);
        if (skew == 0) {
            ledger.recordCustomExpense(groupId, "e", amount, participants, shares, "");
            assertEq(_net(groupId, participants[0]), -int256(cut));
            assertEq(_net(groupId, participants[1]), -int256(second));
            assertEq(_sumOfBalances(groupId), 0);
        } else {
            uint256 offending = skewed > amount ? skewed : cut + skewed;
            vm.expectRevert(
                abi.encodeWithSelector(TallyLedger.ShareTotalMismatch.selector, amount, offending)
            );
            ledger.recordCustomExpense(groupId, "e", amount, participants, shares, "");
        }
    }

    function testFuzz_amountOutsideRangeReverts(uint256 amount) public {
        uint256 max = ledger.MAX_AMOUNT();
        vm.assume(amount == 0 || amount > max);
        uint256 groupId = _createDefaultGroup();
        vm.prank(alice);
        if (amount == 0) {
            vm.expectRevert(TallyLedger.ZeroAmount.selector);
        } else {
            vm.expectRevert(abi.encodeWithSelector(TallyLedger.AmountTooLarge.selector, amount));
        }
        ledger.recordEqualExpense(groupId, "e", amount, _list(bob), "");
    }

    function testFuzz_settlementBoundedByOutstandingDebt(uint256 owed, uint256 paid) public {
        owed = bound(owed, 1, ledger.MAX_AMOUNT());
        paid = bound(paid, 1, ledger.MAX_AMOUNT());
        uint256 groupId = _createDefaultGroup();
        _equal(groupId, alice, "e", owed, _list(bob));

        vm.prank(alice);
        if (paid > owed) {
            vm.expectRevert(
                abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, paid, owed)
            );
            ledger.acknowledgeSettlement(groupId, "s", bob, paid);
        } else {
            ledger.acknowledgeSettlement(groupId, "s", bob, paid);
            assertEq(_net(groupId, bob), -int256(owed - paid));
            assertEq(_net(groupId, alice), int256(owed - paid));
            assertEq(ledger.maxSettleable(groupId, bob, alice), owed - paid);
        }
        assertEq(_sumOfBalances(groupId), 0);
    }
}
