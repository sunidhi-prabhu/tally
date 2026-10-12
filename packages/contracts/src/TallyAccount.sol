// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignerEIP7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerEIP7702.sol";
import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";

/// @title TallyAccount
/// @notice Smart-account code for a passkey wallet, used through EIP-7702: the wallet (an EOA
/// whose key Mera derives from the user's passkey) delegates to this contract, so it can run
/// signed batches that a sponsor submits and pays gas for.
///
/// Security model:
/// - Only the wallet's own key can authorize anything: `executeWithSignature` requires an
///   EIP-712 signature by `address(this)` (the EOA) over the exact calls, a one-time nonce and
///   a deadline. The domain binds the chain ID and the wallet's address, so a signature can't
///   be replayed on another chain or for another wallet. A sponsor can only submit, never
///   change, what the user signed.
/// - The wallet can also call `execute` on itself (paying its own gas), as in ERC-7821.
/// - Storage lives in the EOA. The nonce uses an ERC-7201 namespaced slot so it can't collide
///   with storage of any other code the EOA delegates to later.
/// - No owner, no upgrade path, no module system: nothing to configure or take over.
///
/// Built from OpenZeppelin Contracts v5.7.0 (ERC7821 batch execution, SignerEIP7702, EIP712).
contract TallyAccount is ERC7821, SignerEIP7702, EIP712 {
    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(bytes32 mode,bytes executionData,uint256 nonce,uint256 deadline)");

    /// @dev keccak256(abi.encode(uint256(keccak256("tally.storage.TallyAccount")) - 1)) &
    /// ~bytes32(uint256(0xff))
    bytes32 public constant NONCE_SLOT =
        0x575f1163b78092ce7bc2419fee98a4333c4f41a14069480ce2a06d5b60d64800;

    error SignatureExpired(uint256 deadline);
    error InvalidNonce(uint256 expected, uint256 provided);
    error InvalidSignature();

    event Executed(uint256 indexed nonce, address indexed submittedBy);

    constructor() EIP712("TallyAccount", "1") {}

    /// @notice Lets the wallet receive MON after delegating (an EOA with code and no receive
    /// function would reject plain transfers).
    receive() external payable {}

    /// @notice The next nonce `executeWithSignature` accepts.
    function nonce() public view returns (uint256) {
        return StorageSlot.getUint256Slot(NONCE_SLOT).value;
    }

    /// @notice Runs a batch the wallet signed, submitted by anyone (typically a gas sponsor).
    /// @param mode ERC-7821 single-batch mode (`0x01` followed by zeros); other modes revert.
    /// @param executionData `abi.encode(Execution[])`, as in ERC-7579.
    /// @param signature EIP-712 signature of `Execute(mode, executionData, nonce, deadline)` by
    /// this wallet's key.
    function executeWithSignature(
        bytes32 mode,
        bytes calldata executionData,
        uint256 nonce_,
        uint256 deadline,
        bytes calldata signature
    ) external payable {
        // Seconds-level validator influence is irrelevant for a signature expiry.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        StorageSlot.Uint256Slot storage slot = StorageSlot.getUint256Slot(NONCE_SLOT);
        if (nonce_ != slot.value) revert InvalidNonce(slot.value, nonce_);
        bytes32 digest = executeDigest(mode, executionData, nonce_, deadline);
        if (!_rawSignatureValidation(digest, signature)) revert InvalidSignature();
        if (!supportsExecutionMode(mode)) revert UnsupportedExecutionMode();

        // Effects before interactions: the nonce is spent even if a call re-enters.
        slot.value = nonce_ + 1;
        // The only earlier "call" is the ecrecover precompile, which can't re-enter.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Executed(nonce_, msg.sender);
        ERC7579Utils.execBatch(executionData, ERC7579Utils.EXECTYPE_DEFAULT);
    }

    /// @notice The EIP-712 digest the wallet signs for `executeWithSignature`.
    function executeDigest(
        bytes32 mode,
        bytes calldata executionData,
        uint256 nonce_,
        uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(EXECUTE_TYPEHASH, mode, keccak256(executionData), nonce_, deadline)
            )
        );
    }
}
