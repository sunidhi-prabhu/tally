// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {TallyLedger} from "../src/TallyLedger.sol";
import {MockToken} from "../test/mocks/MockToken.sol";

/// @notice LOCAL ANVIL ONLY. Deploys the test-only MockToken and a TallyLedger, then records a
/// demo history that exercises every event the indexer handles. It refuses to run on any other
/// chain and uses no private keys: anvil's default accounts are unlocked, so run it with
///
///   forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
///     --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///
/// On a fresh anvil the deployer's first two transactions put MockToken at
/// 0x5FbDB2315678afecb367f032d93F642f64180aa3 and TallyLedger at
/// 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 (CREATE addresses for nonces 0 and 1).
contract LocalDemo is Script {
    uint256 internal constant AUSD = 1e6;

    // anvil's default accounts 0-4 (public, unlocked on a local anvil node only).
    address internal constant ALICE = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant BOB = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant CAROL = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant DAVE = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address internal constant EVE = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;

    function run() external {
        require(block.chainid == 31337, "LocalDemo: anvil (chain 31337) only");

        vm.startBroadcast(ALICE);
        MockToken token = new MockToken(6);
        TallyLedger ledger = new TallyLedger(address(token));
        // One transaction, four events: GroupCreated + MemberAdded x4.
        uint256 trip = ledger.createGroup("Trip", _list(BOB, CAROL, DAVE));
        // Equal split, payer participates.
        ledger.recordEqualExpense(trip, "dinner", 30 * AUSD, _sorted3(ALICE, BOB, CAROL), "Dinner");
        ledger.addMember(trip, EVE);
        ledger.removeMember(trip, EVE);
        vm.stopBroadcast();

        // Custom split, payer does not participate.
        (address[] memory who, uint256[] memory shares) = _pair(ALICE, 2 * AUSD, CAROL, 10 * AUSD);
        vm.broadcast(BOB);
        ledger.recordCustomExpense(trip, "taxi", 12 * AUSD, who, shares, "Taxi");

        // Equal split with a remainder: 10 AUSD / 3.
        vm.broadcast(DAVE);
        ledger.recordEqualExpense(trip, "snacks", 10 * AUSD, _sorted3(ALICE, BOB, CAROL), "Snacks");

        // Token settlement: SettlementRecorded + TokenSettled (+ token Transfer) in one transaction.
        vm.startBroadcast(CAROL);
        token.mint(CAROL, 5 * AUSD);
        token.approve(address(ledger), 5 * AUSD);
        ledger.settleWithToken(trip, "carol-pays-alice", ALICE, 5 * AUSD);
        vm.stopBroadcast();

        // Acknowledged settlement: no tokens move.
        vm.broadcast(ALICE);
        ledger.acknowledgeSettlement(trip, "bob-paid-cash", BOB, 1 * AUSD);

        // A second group to exercise per-group filtering.
        vm.startBroadcast(BOB);
        uint256 flat = ledger.createGroup("Flat", _list(CAROL));
        ledger.recordEqualExpense(flat, "rent", 1000 * AUSD, _sorted2(BOB, CAROL), "Rent");
        vm.stopBroadcast();

        console.log("MockToken (test only):", address(token));
        console.log("TallyLedger:", address(ledger));
    }

    function _list(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        (out[0], out[1], out[2]) = (a, b, c);
    }

    function _sorted2(address a, address b) internal pure returns (address[] memory out) {
        out = new address[](2);
        (out[0], out[1]) = a < b ? (a, b) : (b, a);
    }

    function _sorted3(address a, address b, address c)
        internal
        pure
        returns (address[] memory out)
    {
        out = _list(a, b, c);
        for (uint256 i = 1; i < 3; ++i) {
            for (uint256 j = i; j > 0 && out[j - 1] > out[j]; --j) {
                (out[j - 1], out[j]) = (out[j], out[j - 1]);
            }
        }
    }

    function _pair(address a, uint256 shareA, address b, uint256 shareB)
        internal
        pure
        returns (address[] memory who, uint256[] memory shares)
    {
        who = new address[](2);
        shares = new uint256[](2);
        (who[0], shares[0], who[1], shares[1]) =
            a < b ? (a, shareA, b, shareB) : (b, shareB, a, shareA);
    }
}
