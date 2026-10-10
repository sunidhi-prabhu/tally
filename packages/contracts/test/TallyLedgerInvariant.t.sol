// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test, console} from "forge-std/Test.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {MockToken} from "./mocks/MockToken.sol";

/// @dev Drives random valid operations on one group and keeps an independent model of the
/// expected balances. Calls that revert are discarded by the fuzzer along with their effects.
contract LedgerHandler is Test {
    uint256 internal constant ACTORS = 6;

    TallyLedger public immutable ledger;
    MockToken public immutable token;
    uint256 public immutable groupId;
    address[] public actors;
    mapping(address => int256) public expectedNet;
    uint256 public operations;
    uint256 public removals;
    uint256 public refusedRemovals;
    uint256 public reAdds;
    uint256 public tokenSettlements;
    /// Model of each actor's token balance: minted - paid + received.
    mapping(address => uint256) public expectedTokens;
    uint256 public totalMinted;
    uint256 internal nonce;

    constructor(TallyLedger ledger_, MockToken token_) {
        ledger = ledger_;
        token = token_;
        for (uint256 i = 0; i < ACTORS; ++i) {
            actors.push(address(uint160(0xA000 + i * 0x111)));
        }
        address[] memory others = new address[](ACTORS - 1);
        for (uint256 i = 1; i < ACTORS; ++i) {
            others[i - 1] = actors[i];
        }
        vm.prank(actors[0]);
        groupId = ledger.createGroup("Invariant", others);
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    /// Current members among `actors` selected by `mask`, in ascending address order.
    function _participants(uint256 mask) internal view returns (address[] memory list) {
        uint256 count = 0;
        address[] memory buffer = new address[](ACTORS);
        // `actors` is created in ascending order, so filtering keeps the list sorted.
        for (uint256 i = 0; i < ACTORS; ++i) {
            if ((mask >> i) & 1 == 1 && ledger.isMember(groupId, actors[i])) {
                buffer[count++] = actors[i];
            }
        }
        list = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            list[i] = buffer[i];
        }
    }

    function _member(uint256 seed) internal view returns (address actor, bool ok) {
        actor = actors[seed % ACTORS];
        ok = ledger.isMember(groupId, actor);
    }

    function recordEqual(uint256 payerSeed, uint256 amount, uint256 mask) external {
        (address payer, bool ok) = _member(payerSeed);
        address[] memory participants = _participants(mask);
        if (!ok || participants.length == 0) return;
        amount = bound(amount, 1, ledger.MAX_AMOUNT());

        vm.prank(payer);
        ledger.recordEqualExpense(groupId, bytes32(++nonce), amount, participants, "");

        // Model: payer +amount; leftover units one each in list order (ascending addresses).
        expectedNet[payer] += int256(amount);
        uint256 count = participants.length;
        for (uint256 i = 0; i < count; ++i) {
            uint256 share = amount / count + (i < amount % count ? 1 : 0);
            expectedNet[participants[i]] -= int256(share);
        }
        ++operations;
    }

    function recordCustom(uint256 payerSeed, uint256 amount, uint256 mask, uint256 seed) external {
        (address payer, bool ok) = _member(payerSeed);
        address[] memory participants = _participants(mask);
        if (!ok || participants.length == 0) return;
        amount = bound(amount, 1, ledger.MAX_AMOUNT());

        uint256[] memory shares = new uint256[](participants.length);
        uint256 left = amount;
        for (uint256 i = 0; i + 1 < participants.length; ++i) {
            shares[i] = uint256(keccak256(abi.encode(seed, i))) % (left + 1);
            left -= shares[i];
        }
        shares[participants.length - 1] = left;

        vm.prank(payer);
        ledger.recordCustomExpense(groupId, bytes32(++nonce), amount, participants, shares, "");

        expectedNet[payer] += int256(amount);
        for (uint256 i = 0; i < participants.length; ++i) {
            expectedNet[participants[i]] -= int256(shares[i]);
        }
        ++operations;
    }

    function acknowledge(uint256 creditorSeed, uint256 debtorSeed, uint256 amount) external {
        address creditor = actors[creditorSeed % ACTORS];
        address debtor = actors[debtorSeed % ACTORS];
        uint256 max = ledger.maxSettleable(groupId, debtor, creditor);
        if (max == 0) return;
        uint256 cap = ledger.MAX_AMOUNT();
        amount = bound(amount, 1, max < cap ? max : cap);

        vm.prank(creditor);
        ledger.acknowledgeSettlement(groupId, bytes32(++nonce), debtor, amount);

        expectedNet[debtor] += int256(amount);
        expectedNet[creditor] -= int256(amount);
        ++operations;
    }

    /// First debtor/creditor pair with something to settle, scanning from the seeds.
    function _findPair(uint256 debtorSeed, uint256 creditorSeed)
        internal
        view
        returns (address debtor, address creditor, uint256 max)
    {
        for (uint256 i = 0; i < ACTORS; ++i) {
            debtor = actors[(debtorSeed % ACTORS + i) % ACTORS];
            if (ledger.netBalance(groupId, debtor) >= 0) continue;
            for (uint256 j = 0; j < ACTORS; ++j) {
                creditor = actors[(creditorSeed % ACTORS + j) % ACTORS];
                max = ledger.maxSettleable(groupId, debtor, creditor);
                if (max > 0) return (debtor, creditor, max);
            }
        }
        return (address(0), address(0), 0);
    }

    /// Debtor pays a creditor in tokens: funds and approves exactly the amount first.
    function settleWithToken(uint256 debtorSeed, uint256 creditorSeed, uint256 amount) external {
        (address debtor, address creditor, uint256 max) = _findPair(debtorSeed, creditorSeed);
        if (max == 0) return;
        uint256 cap = ledger.MAX_AMOUNT();
        amount = bound(amount, 1, max < cap ? max : cap);

        token.mint(debtor, amount);
        totalMinted += amount;
        expectedTokens[debtor] += amount;
        vm.prank(debtor);
        token.approve(address(ledger), amount);

        vm.prank(debtor);
        ledger.settleWithToken(groupId, bytes32(++nonce), creditor, amount);

        expectedNet[debtor] += int256(amount);
        expectedNet[creditor] -= int256(amount);
        expectedTokens[debtor] -= amount;
        expectedTokens[creditor] += amount;
        ++tokenSettlements;
        ++operations;
    }

    /// A debtor with too little allowance must be refused, with nothing changed.
    function settleWithoutAllowance(uint256 debtorSeed, uint256 creditorSeed) external {
        address debtor = actors[debtorSeed % ACTORS];
        address creditor = actors[creditorSeed % ACTORS];
        if (ledger.maxSettleable(groupId, debtor, creditor) == 0) return;
        uint256 allowance = token.allowance(debtor, address(ledger));
        if (allowance >= ledger.MAX_AMOUNT()) return;
        uint256 amount = allowance + 1;
        if (amount > ledger.maxSettleable(groupId, debtor, creditor)) return;

        vm.prank(debtor);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockToken.InsufficientAllowance.selector, address(ledger), allowance, amount
            )
        );
        ledger.settleWithToken(groupId, bytes32(++nonce), creditor, amount);
    }

    /// Admin tries to remove a member: refused with OutstandingBalance unless the balance is zero.
    function removeMember(uint256 seed) external {
        address member = actors[1 + (seed % (ACTORS - 1))]; // never the admin
        if (!ledger.isMember(groupId, member)) return;
        int256 net = ledger.netBalance(groupId, member);
        vm.prank(actors[0]);
        if (net != 0) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    TallyLedger.OutstandingBalance.selector, groupId, member, net
                )
            );
            ledger.removeMember(groupId, member);
            ++refusedRemovals;
            return;
        }
        ledger.removeMember(groupId, member);
        ++removals;
        ++operations;
    }

    /// Settles a member's whole balance through acknowledgements, then removes them.
    function clearAndRemove(uint256 seed) external {
        address member = actors[1 + (seed % (ACTORS - 1))];
        if (!ledger.isMember(groupId, member)) return;
        uint256 cap = ledger.MAX_AMOUNT();
        for (uint256 round = 0; round < 64; ++round) {
            int256 net = ledger.netBalance(groupId, member);
            if (net == 0) break;
            for (uint256 i = 0; i < ACTORS; ++i) {
                address other = actors[i];
                (address debtor, address creditor) = net < 0 ? (member, other) : (other, member);
                uint256 max = ledger.maxSettleable(groupId, debtor, creditor);
                if (max == 0) continue;
                uint256 amount = max < cap ? max : cap;
                vm.prank(creditor);
                ledger.acknowledgeSettlement(groupId, bytes32(++nonce), debtor, amount);
                expectedNet[debtor] += int256(amount);
                expectedNet[creditor] -= int256(amount);
                break;
            }
        }
        if (ledger.netBalance(groupId, member) != 0) return;
        vm.prank(actors[0]);
        ledger.removeMember(groupId, member);
        ++removals;
        ++operations;
    }

    function reAddMember(uint256 seed) external {
        address member = actors[1 + (seed % (ACTORS - 1))];
        if (ledger.isMember(groupId, member)) return;
        vm.prank(actors[0]);
        ledger.addMember(groupId, member);
        ++reAdds;
        ++operations;
    }

    /// Attempts to over-settle and to replay a used settlement ID; both must revert.
    function attackSettlement(uint256 creditorSeed, uint256 debtorSeed) external {
        address creditor = actors[creditorSeed % ACTORS];
        address debtor = actors[debtorSeed % ACTORS];
        if (creditor == debtor) return;
        if (!ledger.isMember(groupId, creditor) || !ledger.isMember(groupId, debtor)) return;
        uint256 max = ledger.maxSettleable(groupId, debtor, creditor);
        if (max >= ledger.MAX_AMOUNT()) return;

        vm.prank(creditor);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, max + 1, max)
        );
        ledger.acknowledgeSettlement(groupId, bytes32(type(uint256).max - nonce), debtor, max + 1);

        if (nonce > 0 && ledger.settlementRecorded(groupId, bytes32(nonce))) {
            vm.prank(creditor);
            vm.expectRevert(
                abi.encodeWithSelector(TallyLedger.DuplicateSettlementId.selector, bytes32(nonce))
            );
            ledger.acknowledgeSettlement(groupId, bytes32(nonce), debtor, 1);
        }
    }
}

contract TallyLedgerInvariantTest is Test {
    TallyLedger internal ledger;
    LedgerHandler internal handler;
    MockToken internal token;

    function setUp() public {
        token = new MockToken(6);
        ledger = new TallyLedger(address(token));
        handler = new LedgerHandler(ledger, token);
        targetContract(address(handler));
    }

    /// Shows that the run exercised every path (visible with -vv).
    function afterInvariant() public view {
        console.log("operations", handler.operations());
        console.log("removals", handler.removals());
        console.log("refused removals", handler.refusedRemovals());
        console.log("re-adds", handler.reAdds());
        console.log("token settlements", handler.tokenSettlements());
    }

    function invariant_balancesSumToZero() public view {
        int256 sum = 0;
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            sum += ledger.netBalance(handler.groupId(), handler.actors(i));
        }
        assertEq(sum, 0);
    }

    function invariant_balancesMatchIndependentModel() public view {
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address actor = handler.actors(i);
            assertEq(ledger.netBalance(handler.groupId(), actor), handler.expectedNet(actor));
        }
    }

    function invariant_nonMembersHaveZeroBalance() public view {
        uint256 groupId = handler.groupId();
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address actor = handler.actors(i);
            if (!ledger.isMember(groupId, actor)) {
                assertEq(ledger.netBalance(groupId, actor), 0);
            }
        }
    }

    function invariant_membershipBookkeepingConsistent() public view {
        uint256 groupId = handler.groupId();
        address[] memory members = ledger.getMembers(groupId);
        (address admin, uint256 memberCount) = ledger.getGroup(groupId);
        assertEq(members.length, memberCount);
        assertTrue(ledger.isMember(groupId, admin));
        for (uint256 i = 0; i < members.length; ++i) {
            assertTrue(ledger.isMember(groupId, members[i]));
        }
    }

    function invariant_ledgerNeverHoldsTokens() public view {
        assertEq(token.balanceOf(address(ledger)), 0);
    }

    function invariant_tokensConservedAndMatchModel() public view {
        uint256 sum = 0;
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address actor = handler.actors(i);
            uint256 balance = token.balanceOf(actor);
            assertEq(balance, handler.expectedTokens(actor));
            sum += balance;
        }
        assertEq(sum, handler.totalMinted());
        assertEq(token.totalSupply(), handler.totalMinted());
    }
}
