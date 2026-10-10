// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {MockToken} from "./mocks/MockToken.sol";

/// @dev Shared setup and helpers for TallyLedger tests.
abstract contract TallyLedgerBase is Test {
    uint256 internal constant AUSD = 1e6;

    TallyLedger internal ledger;
    /// Test-only stand-in for AUSD (6 decimals). Real AUSD is only exercised in test/fork.
    MockToken internal token;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    address internal outsider;

    function setUp() public virtual {
        token = new MockToken(6);
        ledger = new TallyLedger(address(token));
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        outsider = makeAddr("outsider");
    }

    /// Group with `alice` as admin and bob, carol, dave as members.
    function _createDefaultGroup() internal returns (uint256 groupId) {
        address[] memory others = new address[](3);
        others[0] = bob;
        others[1] = carol;
        others[2] = dave;
        vm.prank(alice);
        groupId = ledger.createGroup("Trip", others);
    }

    function _list(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _list(address a, address b) internal pure returns (address[] memory out) {
        out = new address[](2);
        out[0] = a;
        out[1] = b;
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    function _amounts(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = a;
        out[1] = b;
    }

    /// Insertion sort, ascending: the order the contract requires for participants.
    function _sorted(address[] memory list) internal pure returns (address[] memory) {
        for (uint256 i = 1; i < list.length; ++i) {
            address key = list[i];
            uint256 j = i;
            while (j > 0 && list[j - 1] > key) {
                list[j] = list[j - 1];
                --j;
            }
            list[j] = key;
        }
        return list;
    }

    /// Sorts `participants` and reorders `shares` to match.
    function _sortedPairs(address[] memory participants, uint256[] memory shares)
        internal
        pure
        returns (address[] memory, uint256[] memory)
    {
        for (uint256 i = 1; i < participants.length; ++i) {
            address key = participants[i];
            uint256 keyShare = shares[i];
            uint256 j = i;
            while (j > 0 && participants[j - 1] > key) {
                participants[j] = participants[j - 1];
                shares[j] = shares[j - 1];
                --j;
            }
            participants[j] = key;
            shares[j] = keyShare;
        }
        return (participants, shares);
    }

    function _equal(
        uint256 groupId,
        address payer,
        bytes32 id,
        uint256 amount,
        address[] memory participants
    ) internal {
        vm.prank(payer);
        ledger.recordEqualExpense(groupId, id, amount, _sorted(participants), "");
    }

    function _acknowledge(
        uint256 groupId,
        address creditor,
        bytes32 id,
        address debtor,
        uint256 amount
    ) internal {
        vm.prank(creditor);
        ledger.acknowledgeSettlement(groupId, id, debtor, amount);
    }

    /// Mints `amount` to `who` and approves the ledger for exactly that amount.
    function _fund(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(ledger), amount);
    }

    function _payWithToken(
        uint256 groupId,
        address debtor,
        bytes32 id,
        address creditor,
        uint256 amount
    ) internal {
        vm.prank(debtor);
        ledger.settleWithToken(groupId, id, creditor, amount);
    }

    function _net(uint256 groupId, address member) internal view returns (int256) {
        return ledger.netBalance(groupId, member);
    }

    function _sumOfBalances(uint256 groupId) internal view returns (int256 sum) {
        address[] memory members = ledger.getMembers(groupId);
        for (uint256 i = 0; i < members.length; ++i) {
            sum += ledger.netBalance(groupId, members[i]);
        }
    }
}
