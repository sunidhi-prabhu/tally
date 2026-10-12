// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TallyLedger} from "../src/TallyLedger.sol";
import {TallyLedgerBase} from "./TallyLedgerBase.sol";

/// @dev Invite links: the admin registers an invite key's address; joiners present the key's
/// signature over their own address.
contract TallyLedgerInviteTest is TallyLedgerBase {
    uint256 internal groupId;
    uint256 internal inviteKey = 0x1A71E;
    address internal inviteAddr;

    function setUp() public override {
        super.setUp();
        groupId = _createDefaultGroup();
        inviteAddr = vm.addr(inviteKey);
    }

    function _enableInvites() internal {
        vm.prank(alice);
        ledger.setInviteSigner(groupId, inviteAddr);
    }

    function _invite(uint256 key, uint256 gid, address joiner)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ledger.inviteDigest(gid, joiner));
        return abi.encodePacked(r, s, v);
    }

    function test_join_withValidInvite() public {
        _enableInvites();
        bytes memory invite1 = _invite(inviteKey, groupId, outsider);
        vm.expectEmit(address(ledger));
        emit TallyLedger.MemberAdded(groupId, outsider, outsider);
        vm.prank(outsider);
        ledger.joinWithInvite(groupId, invite1);
        assertTrue(ledger.isMember(groupId, outsider));
        (, uint256 count) = ledger.getGroup(groupId);
        assertEq(count, 5);
    }

    function test_onlyAdmin_setsInviteSigner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.NotGroupAdmin.selector, groupId, bob));
        ledger.setInviteSigner(groupId, inviteAddr);

        vm.expectEmit(address(ledger));
        emit TallyLedger.InviteSignerSet(groupId, inviteAddr);
        _enableInvites();
        assertEq(ledger.inviteSigner(groupId), inviteAddr);
    }

    function test_invitesOff_byDefault() public {
        bytes memory invite2 = _invite(inviteKey, groupId, outsider);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvitesDisabled.selector, groupId));
        ledger.joinWithInvite(groupId, invite2);
    }

    function test_inviteIsBoundToTheJoiner() public {
        _enableInvites();
        // A signature for `outsider`, seen in the mempool, is useless to anyone else.
        bytes memory forOutsider = _invite(inviteKey, groupId, outsider);
        address thief = makeAddr("thief");
        vm.prank(thief);
        vm.expectRevert(TallyLedger.InvalidInvite.selector);
        ledger.joinWithInvite(groupId, forOutsider);
    }

    function test_inviteIsBoundToTheGroup() public {
        _enableInvites();
        address[] memory none = new address[](0);
        vm.prank(alice);
        uint256 other = ledger.createGroup("Other", none);
        vm.prank(alice);
        ledger.setInviteSigner(other, makeAddr("otherSigner"));
        bytes memory invite3 = _invite(inviteKey, groupId, outsider);
        vm.prank(outsider);
        vm.expectRevert(TallyLedger.InvalidInvite.selector);
        ledger.joinWithInvite(other, invite3);
    }

    function test_wrongKey_reverts() public {
        _enableInvites();
        bytes memory invite4 = _invite(0xBAD, groupId, outsider);
        vm.prank(outsider);
        vm.expectRevert(TallyLedger.InvalidInvite.selector);
        ledger.joinWithInvite(groupId, invite4);
    }

    function test_malformedSignature_reverts() public {
        _enableInvites();
        vm.prank(outsider);
        vm.expectRevert(TallyLedger.InvalidInvite.selector);
        ledger.joinWithInvite(groupId, hex"1234");
    }

    function test_rotatingTheKey_revokesOldLinks() public {
        _enableInvites();
        bytes memory oldInvite = _invite(inviteKey, groupId, outsider);
        vm.prank(alice);
        ledger.setInviteSigner(groupId, vm.addr(0x2222));
        vm.prank(outsider);
        vm.expectRevert(TallyLedger.InvalidInvite.selector);
        ledger.joinWithInvite(groupId, oldInvite);

        vm.prank(alice);
        ledger.setInviteSigner(groupId, address(0));
        bytes memory invite5 = _invite(0x2222, groupId, outsider);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.InvitesDisabled.selector, groupId));
        ledger.joinWithInvite(groupId, invite5);
    }

    function test_existingMember_cannotJoinAgain() public {
        _enableInvites();
        bytes memory invite6 = _invite(inviteKey, groupId, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.AlreadyMember.selector, groupId, bob));
        ledger.joinWithInvite(groupId, invite6);
    }

    function test_unknownGroup_reverts() public {
        bytes memory invite7 = _invite(inviteKey, 999, outsider);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(TallyLedger.GroupNotFound.selector, 999));
        ledger.joinWithInvite(999, invite7);
    }

    function test_digest_bindsChainAndContract() public {
        bytes32 here = ledger.inviteDigest(groupId, outsider);
        vm.chainId(block.chainid + 1);
        assertTrue(ledger.inviteDigest(groupId, outsider) != here);
        TallyLedger second = new TallyLedger(address(token));
        assertTrue(second.inviteDigest(groupId, outsider) != here);
    }

    function test_joinedMember_canRecordExpenses() public {
        _enableInvites();
        bytes memory invite8 = _invite(inviteKey, groupId, outsider);
        vm.prank(outsider);
        ledger.joinWithInvite(groupId, invite8);
        _equal(groupId, outsider, "e1", 10 * AUSD, _list(alice, outsider));
        assertEq(_net(groupId, outsider), int256(5 * AUSD));
        assertEq(_sumOfBalances(groupId), 0);
    }
}
