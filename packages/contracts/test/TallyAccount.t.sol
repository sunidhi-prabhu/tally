// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Account as OZAccount} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {TallyAccount} from "../src/TallyAccount.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {MockToken} from "./mocks/MockToken.sol";

/// @dev A passkey wallet (EOA) delegated to TallyAccount via EIP-7702, driven by a sponsor.
contract TallyAccountTest is Test {
    bytes32 internal constant BATCH = bytes32(uint256(1) << 248);
    uint256 internal constant AUSD = 1e6;

    TallyAccount internal impl;
    TallyLedger internal ledger;
    MockToken internal token;

    uint256 internal userKey = 0xA11CE;
    address internal user;
    uint256 internal otherKey = 0xB0B;
    address internal other;
    address internal sponsor = makeAddr("sponsor");
    address internal friend = makeAddr("friend");

    function setUp() public {
        impl = new TallyAccount();
        token = new MockToken(6);
        ledger = new TallyLedger(address(token));
        user = vm.addr(userKey);
        other = vm.addr(otherKey);
        _delegate(userKey);
        _delegate(otherKey);
    }

    function _delegate(uint256 key) internal {
        vm.signAndAttachDelegation(address(impl), key);
        // Any call applies the attached authorization; the designator then stays in place.
        TallyAccount(payable(vm.addr(key))).nonce();
    }

    function _wallet(address who) internal pure returns (TallyAccount) {
        return TallyAccount(payable(who));
    }

    function _batch(Execution[] memory calls) internal pure returns (bytes memory) {
        return abi.encode(calls);
    }

    function _one(address target, bytes memory data) internal pure returns (Execution[] memory c) {
        c = new Execution[](1);
        c[0] = Execution(target, 0, data);
    }

    function _sign(uint256 key, address wallet, bytes memory data, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = _wallet(wallet).executeDigest(BATCH, data, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Group with `user` (admin) and `friend`; friend paid 10 AUSD split equally, so user owes 5.
    function _groupWithDebt() internal returns (uint256 groupId) {
        address[] memory members = new address[](1);
        members[0] = friend;
        vm.prank(user);
        groupId = ledger.createGroup("Trip", members);
        address[] memory both = new address[](2);
        (both[0], both[1]) = user < friend ? (user, friend) : (friend, user);
        vm.prank(friend);
        ledger.recordEqualExpense(groupId, "dinner", 10 * AUSD, both, "Dinner");
    }

    function test_nonceSlot_isErc7201() public view {
        bytes32 expected = keccak256(
            abi.encode(uint256(keccak256("tally.storage.TallyAccount")) - 1)
        ) & ~bytes32(uint256(0xff));
        assertEq(impl.NONCE_SLOT(), expected);
    }

    function test_sponsorSubmits_onePayment_approveAndSettleInOneBatch() public {
        uint256 groupId = _groupWithDebt();
        token.mint(user, 5 * AUSD);
        assertEq(user.balance, 0);

        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(
            address(token), 0, abi.encodeCall(token.approve, (address(ledger), 5 * AUSD))
        );
        calls[1] = Execution(
            address(ledger),
            0,
            abi.encodeCall(ledger.settleWithToken, (groupId, "pay", friend, 5 * AUSD))
        );
        bytes memory data = _batch(calls);
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);

        vm.expectEmit(user);
        emit TallyAccount.Executed(0, sponsor);
        vm.prank(sponsor);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);

        // The ledger saw the passkey wallet itself as the debtor.
        assertEq(ledger.netBalance(groupId, user), 0);
        assertEq(ledger.netBalance(groupId, friend), 0);
        assertEq(token.balanceOf(friend), 5 * AUSD);
        assertEq(token.balanceOf(user), 0);
        assertEq(user.balance, 0, "the wallet never needed MON");
        assertEq(_wallet(user).nonce(), 1);
    }

    function test_expenseFromWallet_recordsWalletAsPayer() public {
        uint256 groupId = _groupWithDebt();
        address[] memory both = new address[](2);
        (both[0], both[1]) = user < friend ? (user, friend) : (friend, user);
        bytes memory data = _batch(
            _one(
                address(ledger),
                abi.encodeCall(ledger.recordEqualExpense, (groupId, "taxi", 4 * AUSD, both, "Taxi"))
            )
        );
        vm.prank(sponsor);
        _wallet(user)
            .executeWithSignature(
                BATCH,
                data,
                0,
                block.timestamp + 60,
                _sign(userKey, user, data, 0, block.timestamp + 60)
            );
        // user owed 5, then paid 4 split equally: owes 5 - 2 = 3.
        assertEq(ledger.netBalance(groupId, user), -int256(3 * AUSD));
    }

    function test_wrongSigner_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(otherKey, user, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
    }

    function test_signatureForAnotherWallet_cannotBeUsedHere() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        // `other` signs for itself; the domain binds the wallet address, so it fails on `user`
        // even though both run the same code.
        bytes memory sig = _sign(otherKey, other, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
    }

    function test_replay_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(TallyAccount.InvalidNonce.selector, 1, 0));
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
    }

    function test_tamperedCalls_revert() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);
        bytes memory tampered = _batch(
            _one(address(token), abi.encodeCall(token.approve, (sponsor, type(uint256).max)))
        );
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, tampered, 0, block.timestamp + 60, sig);
    }

    function test_changedDeadline_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 3600, sig);
    }

    function test_expired_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        // Read before the warp on purpose: the signature expires, then time passes.
        // forge-lint: disable-next-line(environment-read-across-mutation)
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _sign(userKey, user, data, 0, deadline);
        vm.warp(deadline + 1);
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(TallyAccount.SignatureExpired.selector, deadline));
        _wallet(user).executeWithSignature(BATCH, data, 0, deadline, sig);
    }

    function test_otherChain_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);
        vm.chainId(block.chainid + 1);
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
    }

    function test_unsupportedMode_reverts() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes32 single = bytes32(0); // ERC-7579 single-call mode: not supported
        bytes32 digest = _wallet(user).executeDigest(single, data, 0, block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, digest);
        vm.prank(sponsor);
        vm.expectRevert(ERC7821.UnsupportedExecutionMode.selector);
        _wallet(user)
            .executeWithSignature(single, data, 0, block.timestamp + 60, abi.encodePacked(r, s, v));
    }

    function test_failingCall_revertsBatch_andKeepsNonce() public {
        uint256 groupId = _groupWithDebt();
        // Paying 6 when only 5 is owed reverts inside the batch.
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(
            address(token), 0, abi.encodeCall(token.approve, (address(ledger), 6 * AUSD))
        );
        calls[1] = Execution(
            address(ledger),
            0,
            abi.encodeCall(ledger.settleWithToken, (groupId, "pay", friend, 6 * AUSD))
        );
        bytes memory data = _batch(calls);
        bytes memory sig = _sign(userKey, user, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        vm.expectRevert(
            abi.encodeWithSelector(TallyLedger.SettlementExceedsDebt.selector, 6 * AUSD, 5 * AUSD)
        );
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
        assertEq(_wallet(user).nonce(), 0);
        assertEq(token.allowance(user, address(ledger)), 0, "the approve was rolled back too");
    }

    function test_directExecute_onlyByTheWalletItself() public {
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 7))));
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(OZAccount.AccountUnauthorized.selector, sponsor));
        _wallet(user).execute(BATCH, data);

        // The wallet calling itself (paying its own gas) works, as in ERC-7821.
        vm.prank(user);
        _wallet(user).execute(BATCH, data);
        assertEq(token.allowance(user, sponsor), 7);
    }

    function test_receivesMon() public {
        vm.deal(sponsor, 1 ether);
        vm.prank(sponsor);
        (bool ok,) = user.call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(user.balance, 0.1 ether);
    }

    function testFuzz_onlyTheWalletKeyAuthorizes(uint256 attackerKey) public {
        attackerKey = bound(attackerKey, 1, 2 ** 128);
        vm.assume(attackerKey != userKey);
        bytes memory data =
            _batch(_one(address(token), abi.encodeCall(token.approve, (sponsor, 1))));
        bytes memory sig = _sign(attackerKey, user, data, 0, block.timestamp + 60);
        vm.prank(sponsor);
        vm.expectRevert(TallyAccount.InvalidSignature.selector);
        _wallet(user).executeWithSignature(BATCH, data, 0, block.timestamp + 60, sig);
    }
}
