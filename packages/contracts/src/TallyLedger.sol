// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev The subset of ERC-20 the ledger uses. `transferFrom` is called through a low-level call
/// so tokens that return nothing are also supported.
interface IERC20Like {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title TallyLedger
/// @notice Shared-expense accounting for groups, mirroring the rules in `packages/core`.
///
/// Each group tracks a net balance per member in AUSD base units (6 decimals):
/// positive = owed money, negative = owes money. Balances in a group always sum to zero.
///
/// SETTLEMENTS come in two kinds, recorded per ID in `settlementKind`:
/// - `TokenTransfer` (`settleWithToken`): the debtor pays the creditor in `settlementToken`
///   inside the same transaction. The ledger checks the recipient's balance rose by exactly
///   the amount. This is the only kind that proves a payment happened.
/// - `Acknowledged` (`acknowledgeSettlement`): the creditor states they were paid outside the
///   contract. NO tokens move; it is an accounting assertion, not proof of payment.
/// The ledger never holds tokens: payments go directly from debtor to creditor.
///
/// Authorization:
/// - Anyone may create a group and becomes its admin and first member.
/// - Only the admin adds or removes members. Members may leave themselves. The admin cannot
///   be removed or leave. A member can only be removed while their balance is exactly zero,
///   so membership changes never alter balances or orphan debts.
/// - Only a member can record an expense, and only as its payer (`msg.sender`). Participants
///   must be current members. Members trust each other not to record false expenses.
/// - An expense can be undone once, by its payer or the group admin. Undoing applies the exact
///   opposite balance changes; the expense stays in the history, marked undone. Its payer and
///   participants must still be members, so an undo never leaves a debt on a former member.
/// - Only the creditor can acknowledge a settlement, which can only reduce their own credit.
/// - Only the debtor can pay with tokens, and only from their own balance (`msg.sender`). The
///   ledger never pulls tokens from anyone other than the caller.
/// - The settlement token is fixed at deployment. There is no owner and no way to change it,
///   so nobody can later swap in a different token that debtors could "pay" with.
///
/// Participant lists must be sorted strictly ascending by address. This rejects duplicates in
/// O(n) and fixes the order used for equal-split remainders.
contract TallyLedger {
    /// @notice Same cap as `MAX_AMOUNT` in packages/core: 1 trillion AUSD in base units.
    /// Applies to each expense and settlement, not to accumulated balances.
    uint256 public constant MAX_AMOUNT = 1e18;
    /// @notice Bounds per-call loops (equal splits write one balance per participant).
    uint256 public constant MAX_MEMBERS = 100;
    uint256 public constant MAX_NAME_BYTES = 64;
    /// @dev packages/core limits descriptions to 280 UTF-16 characters; this limits UTF-8 bytes.
    uint256 public constant MAX_DESCRIPTION_BYTES = 280;
    /// @notice Balances are in 6-decimal base units, so the token must use 6 decimals.
    uint8 public constant TOKEN_DECIMALS = 6;

    enum SplitType {
        Equal,
        Custom
    }

    enum ExpenseStatus {
        /// No expense with this ID.
        None,
        /// Recorded and counted in balances.
        Active,
        /// Recorded, then undone: its balance changes were reversed.
        Undone
    }

    enum SettlementKind {
        /// No settlement with this ID.
        None,
        /// Creditor states they received payment outside this contract. No tokens moved.
        Acknowledged,
        /// Debtor paid the creditor in `settlementToken` in the same transaction.
        TokenTransfer
    }

    struct Group {
        address admin;
        uint32 memberCount;
    }

    /// @notice The ERC-20 used by `settleWithToken` (intended: Agora AUSD). Set once at deployment.
    IERC20Like public immutable settlementToken;

    uint256 public nextGroupId = 1;
    uint256 private _lock = 1;

    mapping(uint256 groupId => Group) private _groups;
    mapping(uint256 groupId => address[]) private _members;
    /// @dev 1-based index into `_members`; 0 means not a member.
    mapping(uint256 groupId => mapping(address member => uint256)) private _memberIndex;
    mapping(uint256 groupId => mapping(address member => int256)) private _net;
    mapping(uint256 groupId => mapping(bytes32 expenseId => ExpenseStatus)) public expenseStatus;
    /// @notice keccak256(abi.encode(payer, amount, participants, shares)) of each recorded
    /// expense. `undoExpense` takes those details back and must match it exactly, so only the
    /// original balance changes can be reversed, without storing every share on-chain.
    mapping(uint256 groupId => mapping(bytes32 expenseId => bytes32)) public expenseHash;
    /// @notice How a settlement ID was used. IDs are shared across both kinds.
    mapping(uint256 groupId => mapping(bytes32 settlementId => SettlementKind)) public
        settlementKind;

    event GroupCreated(uint256 indexed groupId, address indexed admin, string name);
    event MemberAdded(uint256 indexed groupId, address indexed member, address indexed addedBy);
    event MemberRemoved(uint256 indexed groupId, address indexed member, address indexed removedBy);
    /// @dev `participants` and `shares` are parallel arrays; `shares` sum to `amount`.
    event ExpenseRecorded(
        uint256 indexed groupId,
        bytes32 indexed expenseId,
        address indexed payer,
        uint256 amount,
        SplitType splitType,
        address[] participants,
        uint256[] shares,
        string description
    );
    /// @notice The expense's balance changes were reversed. Its details are in its
    /// `ExpenseRecorded` event.
    event ExpenseUndone(
        uint256 indexed groupId, bytes32 indexed expenseId, address indexed undoneBy
    );
    event SettlementRecorded(
        uint256 indexed groupId,
        bytes32 indexed settlementId,
        address indexed from,
        address to,
        uint256 amount,
        SettlementKind kind
    );
    /// @notice Emitted only when tokens actually moved, alongside `SettlementRecorded`.
    /// Rebuild balances from `SettlementRecorded`; use this event for payment details.
    event TokenSettled(
        uint256 indexed groupId,
        bytes32 indexed settlementId,
        address indexed from,
        address to,
        address token,
        uint256 amount
    );

    error GroupNotFound(uint256 groupId);
    error NotGroupAdmin(uint256 groupId, address account);
    error NotMember(uint256 groupId, address account);
    error AlreadyMember(uint256 groupId, address account);
    error ZeroAddress();
    error TooManyMembers(uint256 groupId);
    error AdminCannotBeRemoved(uint256 groupId);
    error OutstandingBalance(uint256 groupId, address member, int256 net);
    error InvalidName();
    error DescriptionTooLong();
    error InvalidId();
    error ZeroAmount();
    error AmountTooLarge(uint256 amount);
    error EmptyParticipants();
    error DuplicateParticipant(address participant);
    error ParticipantsNotSorted();
    error LengthMismatch();
    error ShareTotalMismatch(uint256 expected, uint256 actual);
    error DuplicateExpenseId(bytes32 expenseId);
    error DuplicateSettlementId(bytes32 settlementId);
    error ExpenseNotActive(bytes32 expenseId);
    error ExpenseDetailsMismatch(bytes32 expenseId);
    error NotAllowedToUndo(uint256 groupId, address account);
    error SelfSettlement();
    error SettlementExceedsDebt(uint256 requested, uint256 max);
    error InvalidToken(address token);
    error InvalidMember(address account);
    error TokenTransferFailed();
    error TokenAmountMismatch(uint256 expected, uint256 received);
    error Reentrancy();

    /// @dev Applied to every state-changing function, so a token callback cannot re-enter any
    /// of them mid-settlement. Uses a storage slot (not transient storage) to avoid depending on
    /// EIP-1153 support.
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @param token The settlement token. Must be a contract reporting 6 decimals. Verify the
    /// address against Agora's official deployments before deploying; it cannot be changed.
    constructor(address token) {
        if (token.code.length == 0) revert InvalidToken(token);
        try IERC20Like(token).decimals() returns (uint8 decimals_) {
            if (decimals_ != TOKEN_DECIMALS) revert InvalidToken(token);
        } catch {
            revert InvalidToken(token);
        }
        settlementToken = IERC20Like(token);
    }

    // ---------------------------------------------------------------- groups and membership

    /// @notice Creates a group with the caller as admin and first member.
    /// @param initialMembers Additional members; must be non-zero and unique.
    function createGroup(string calldata name, address[] calldata initialMembers)
        external
        nonReentrant
        returns (uint256 groupId)
    {
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0 || nameLength > MAX_NAME_BYTES) revert InvalidName();

        groupId = nextGroupId++;
        _groups[groupId].admin = msg.sender;
        emit GroupCreated(groupId, msg.sender, name);

        _addMember(groupId, msg.sender);
        for (uint256 i = 0; i < initialMembers.length; ++i) {
            _addMember(groupId, initialMembers[i]);
        }
    }

    /// @notice Admin only.
    function addMember(uint256 groupId, address member) external nonReentrant {
        _requireAdmin(groupId);
        _addMember(groupId, member);
    }

    /// @notice Admin only. The member's balance must be exactly zero.
    function removeMember(uint256 groupId, address member) external nonReentrant {
        _requireAdmin(groupId);
        _removeMember(groupId, member);
    }

    /// @notice Leave a group. The caller's balance must be exactly zero; the admin cannot leave.
    function leaveGroup(uint256 groupId) external nonReentrant {
        _requireGroup(groupId);
        _removeMember(groupId, msg.sender);
    }

    // ---------------------------------------------------------------- expenses

    /// @notice Records an expense paid by the caller, split equally.
    /// Each participant owes `amount / n`. The `amount % n` leftover units go one each to the
    /// first participants in ascending address order, matching `splitEqual` in packages/core
    /// for lowercase hex addresses.
    /// @param participants Current members, sorted strictly ascending. May include the caller.
    function recordEqualExpense(
        uint256 groupId,
        bytes32 expenseId,
        uint256 amount,
        address[] calldata participants,
        string calldata description
    ) external nonReentrant {
        _beginExpense(groupId, expenseId, amount, participants, description);

        uint256 count = participants.length;
        uint256 base = amount / count;
        uint256 remainder = amount % count;
        uint256[] memory shares = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            shares[i] = i < remainder ? base + 1 : base;
        }
        _applyExpense(
            groupId, expenseId, amount, SplitType.Equal, participants, shares, description
        );
    }

    /// @notice Records an expense paid by the caller with explicit shares.
    /// Shares may be zero but must add up to `amount` exactly.
    /// @param participants Current members, sorted strictly ascending. May include the caller.
    /// @param shares Parallel to `participants`.
    function recordCustomExpense(
        uint256 groupId,
        bytes32 expenseId,
        uint256 amount,
        address[] calldata participants,
        uint256[] calldata shares,
        string calldata description
    ) external nonReentrant {
        _beginExpense(groupId, expenseId, amount, participants, description);
        if (shares.length != participants.length) revert LengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < shares.length; ++i) {
            // Each share <= amount <= MAX_AMOUNT and count <= MAX_MEMBERS, so `total` cannot
            // overflow; reject early so an oversized share cannot hide behind the sum.
            if (shares[i] > amount) revert ShareTotalMismatch(amount, shares[i]);
            total += shares[i];
        }
        if (total != amount) revert ShareTotalMismatch(amount, total);

        _applyExpense(
            groupId, expenseId, amount, SplitType.Custom, participants, shares, description
        );
    }

    /// @notice Undoes an active expense: the payer's credit and every participant's share are
    /// reversed exactly, and the expense is marked `Undone` (it cannot be undone twice or
    /// re-recorded under the same ID). Only the payer or the group admin may call this.
    /// Pass the expense's details exactly as emitted in `ExpenseRecorded`; they must match
    /// `expenseHash`. The payer and every participant must still be members.
    /// Undoing after settlements is allowed: balances then reflect that money changed hands
    /// for an expense that no longer counts, so whoever was paid may now owe it back.
    function undoExpense(
        uint256 groupId,
        bytes32 expenseId,
        address payer,
        uint256 amount,
        address[] calldata participants,
        uint256[] calldata shares
    ) external nonReentrant {
        _requireGroup(groupId);
        if (expenseStatus[groupId][expenseId] != ExpenseStatus.Active) {
            revert ExpenseNotActive(expenseId);
        }
        if (
            keccak256(abi.encode(payer, amount, participants, shares))
                != expenseHash[groupId][expenseId]
        ) {
            revert ExpenseDetailsMismatch(expenseId);
        }
        if (msg.sender != payer && msg.sender != _groups[groupId].admin) {
            revert NotAllowedToUndo(groupId, msg.sender);
        }
        if (!isMember(groupId, payer)) revert NotMember(groupId, payer);
        for (uint256 i = 0; i < participants.length; ++i) {
            if (!isMember(groupId, participants[i])) revert NotMember(groupId, participants[i]);
        }

        expenseStatus[groupId][expenseId] = ExpenseStatus.Undone;
        // The exact opposite of `_applyExpense`. The hash matched, so these are the amounts
        // that were applied, each <= MAX_AMOUNT.
        _net[groupId][payer] -= _toInt(amount);
        for (uint256 i = 0; i < participants.length; ++i) {
            _net[groupId][participants[i]] += _toInt(shares[i]);
        }
        emit ExpenseUndone(groupId, expenseId, msg.sender);
    }

    // ---------------------------------------------------------------- settlements

    /// @notice Pays `to` in `settlementToken` and records the settlement, atomically.
    /// The caller is the debtor and pays from their own balance; approve this contract for
    /// `amount` first. The caller must owe money, `to` must be owed money, and `amount` may not
    /// exceed `maxSettleable(groupId, caller, to)` or MAX_AMOUNT. If the transfer fails, or `to`
    /// does not receive exactly `amount`, the whole call reverts and nothing is recorded.
    function settleWithToken(uint256 groupId, bytes32 settlementId, address to, uint256 amount)
        external
        nonReentrant
    {
        _applySettlement(
            groupId, settlementId, msg.sender, to, amount, SettlementKind.TokenTransfer
        );

        emit TokenSettled(groupId, settlementId, msg.sender, to, address(settlementToken), amount);
        // Interaction last (checks-effects-interactions); the guard blocks re-entry.
        uint256 balanceBefore = settlementToken.balanceOf(to);
        _safeTransferFrom(msg.sender, to, amount);
        uint256 balanceAfter = settlementToken.balanceOf(to);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert TokenAmountMismatch(
                amount, balanceAfter < balanceBefore ? 0 : balanceAfter - balanceBefore
            );
        }
    }

    /// @notice ACCOUNTING ASSERTION ONLY, no tokens move. The caller (creditor) states that
    /// `from` paid them `amount` outside this contract, reducing both balances.
    /// `from` must owe money, the caller must be owed money, and `amount` may not exceed
    /// `maxSettleable(groupId, from, caller)`. Recorded as `SettlementKind.Acknowledged`.
    function acknowledgeSettlement(
        uint256 groupId,
        bytes32 settlementId,
        address from,
        uint256 amount
    ) external nonReentrant {
        _applySettlement(
            groupId, settlementId, from, msg.sender, amount, SettlementKind.Acknowledged
        );
    }

    // ---------------------------------------------------------------- views

    /// @notice The most `from` can settle with `to` now: min(what `from` owes, what `to` is
    /// owed), or 0 if either has nothing outstanding. May exceed MAX_AMOUNT, in which case the
    /// debt must be settled in several parts.
    function maxSettleable(uint256 groupId, address from, address to)
        public
        view
        returns (uint256)
    {
        if (from == to) return 0;
        int256 fromNet = _net[groupId][from];
        int256 toNet = _net[groupId][to];
        if (fromNet >= 0 || toNet <= 0) return 0;
        // fromNet > type(int256).min: reaching it would need ~5.8e58 max-size expenses.
        // forge-lint: disable-next-line(unsafe-typecast) fromNet < 0, so -fromNet > 0
        uint256 debt = uint256(-fromNet);
        // forge-lint: disable-next-line(unsafe-typecast) toNet > 0
        uint256 credit = uint256(toNet);
        return debt < credit ? debt : credit;
    }

    /// @notice True if the ID was used for an expense, whether still active or undone.
    function expenseRecorded(uint256 groupId, bytes32 expenseId) external view returns (bool) {
        return expenseStatus[groupId][expenseId] != ExpenseStatus.None;
    }

    /// @notice True if the ID was used by either settlement kind.
    function settlementRecorded(uint256 groupId, bytes32 settlementId)
        external
        view
        returns (bool)
    {
        return settlementKind[groupId][settlementId] != SettlementKind.None;
    }

    function netBalance(uint256 groupId, address member) external view returns (int256) {
        return _net[groupId][member];
    }

    function isMember(uint256 groupId, address account) public view returns (bool) {
        return _memberIndex[groupId][account] != 0;
    }

    /// @notice Current members (order changes when members are removed).
    function getMembers(uint256 groupId) external view returns (address[] memory) {
        return _members[groupId];
    }

    function getGroup(uint256 groupId) external view returns (address admin, uint256 memberCount) {
        Group storage group = _groups[groupId];
        return (group.admin, group.memberCount);
    }

    function groupExists(uint256 groupId) public view returns (bool) {
        return _groups[groupId].admin != address(0);
    }

    // ---------------------------------------------------------------- internal

    function _requireGroup(uint256 groupId) private view {
        if (!groupExists(groupId)) revert GroupNotFound(groupId);
    }

    function _requireAdmin(uint256 groupId) private view {
        _requireGroup(groupId);
        if (_groups[groupId].admin != msg.sender) revert NotGroupAdmin(groupId, msg.sender);
    }

    function _requireMember(uint256 groupId, address account) private view {
        _requireGroup(groupId);
        if (!isMember(groupId, account)) revert NotMember(groupId, account);
    }

    function _requireValidAmount(uint256 amount) private pure {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_AMOUNT) revert AmountTooLarge(amount);
    }

    /// @dev Only called with amounts <= MAX_AMOUNT, which always fit in int256.
    function _toInt(uint256 amount) private pure returns (int256) {
        // forge-lint: disable-next-line(unsafe-typecast) amount <= MAX_AMOUNT < type(int256).max
        return int256(amount);
    }

    /// @dev Shared checks and accounting for both settlement kinds. Caller authorization is
    /// implied by the arguments: acknowledgements pass `to = msg.sender`, token payments pass
    /// `from = msg.sender`.
    function _applySettlement(
        uint256 groupId,
        bytes32 settlementId,
        address from,
        address to,
        uint256 amount,
        SettlementKind kind
    ) private {
        _requireMember(groupId, msg.sender);
        _requireMember(groupId, from == msg.sender ? to : from);
        if (from == to) revert SelfSettlement();
        if (settlementId == bytes32(0)) revert InvalidId();
        if (settlementKind[groupId][settlementId] != SettlementKind.None) {
            revert DuplicateSettlementId(settlementId);
        }
        _requireValidAmount(amount);

        uint256 max = maxSettleable(groupId, from, to);
        if (amount > max) revert SettlementExceedsDebt(amount, max);

        settlementKind[groupId][settlementId] = kind;
        int256 delta = _toInt(amount);
        _net[groupId][from] += delta;
        _net[groupId][to] -= delta;
        emit SettlementRecorded(groupId, settlementId, from, to, amount, kind);
    }

    /// @dev Calls `transferFrom` and accepts either `true` or no return data. Bubbles the
    /// token's revert reason (e.g. insufficient allowance or balance) when there is one.
    function _safeTransferFrom(address from, address to, uint256 amount) private {
        // The nonReentrant lock is held during this call; the lint flags its later reset.
        // forge-lint: disable-start(reentrancy-no-eth)
        (bool success, bytes memory data) = address(settlementToken)
            .call(abi.encodeCall(IERC20Like.transferFrom, (from, to, amount)));
        // forge-lint: disable-end(reentrancy-no-eth)
        if (!success) {
            if (data.length == 0) revert TokenTransferFailed();
            assembly ("memory-safe") {
                revert(add(data, 32), mload(data))
            }
        }
        if (data.length != 0 && (data.length != 32 || abi.decode(data, (uint256)) != 1)) {
            revert TokenTransferFailed();
        }
    }

    function _addMember(uint256 groupId, address member) private {
        if (member == address(0)) revert ZeroAddress();
        // Payments to these addresses would be stuck or meaningless.
        if (member == address(this) || member == address(settlementToken)) {
            revert InvalidMember(member);
        }
        if (isMember(groupId, member)) revert AlreadyMember(groupId, member);
        Group storage group = _groups[groupId];
        if (group.memberCount >= MAX_MEMBERS) revert TooManyMembers(groupId);

        _members[groupId].push(member);
        _memberIndex[groupId][member] = _members[groupId].length;
        group.memberCount += 1;
        emit MemberAdded(groupId, member, msg.sender);
    }

    function _removeMember(uint256 groupId, address member) private {
        uint256 index = _memberIndex[groupId][member];
        if (index == 0) revert NotMember(groupId, member);
        if (member == _groups[groupId].admin) revert AdminCannotBeRemoved(groupId);
        int256 net = _net[groupId][member];
        if (net != 0) revert OutstandingBalance(groupId, member, net);

        address[] storage members = _members[groupId];
        address last = members[members.length - 1];
        members[index - 1] = last;
        _memberIndex[groupId][last] = index;
        members.pop();
        delete _memberIndex[groupId][member];
        _groups[groupId].memberCount -= 1;
        emit MemberRemoved(groupId, member, msg.sender);
    }

    /// @dev Checks shared by both expense types: caller membership, ID, amount, description,
    /// and that participants are members sorted strictly ascending (hence unique).
    function _beginExpense(
        uint256 groupId,
        bytes32 expenseId,
        uint256 amount,
        address[] calldata participants,
        string calldata description
    ) private view {
        _requireMember(groupId, msg.sender);
        if (expenseId == bytes32(0)) revert InvalidId();
        if (expenseStatus[groupId][expenseId] != ExpenseStatus.None) {
            revert DuplicateExpenseId(expenseId);
        }
        _requireValidAmount(amount);
        if (bytes(description).length > MAX_DESCRIPTION_BYTES) revert DescriptionTooLong();

        uint256 count = participants.length;
        if (count == 0) revert EmptyParticipants();
        address previous = address(0);
        for (uint256 i = 0; i < count; ++i) {
            address participant = participants[i];
            if (i > 0) {
                if (participant == previous) revert DuplicateParticipant(participant);
                if (participant < previous) revert ParticipantsNotSorted();
            }
            if (!isMember(groupId, participant)) revert NotMember(groupId, participant);
            previous = participant;
        }
    }

    function _applyExpense(
        uint256 groupId,
        bytes32 expenseId,
        uint256 amount,
        SplitType splitType,
        address[] calldata participants,
        uint256[] memory shares,
        string calldata description
    ) private {
        expenseStatus[groupId][expenseId] = ExpenseStatus.Active;
        expenseHash[groupId][expenseId] =
            keccak256(abi.encode(msg.sender, amount, participants, shares));
        // The payer is credited in full and debited their own share like everyone else, so a
        // participating payer nets `amount - ownShare` and never owes themselves.
        _net[groupId][msg.sender] += _toInt(amount);
        for (uint256 i = 0; i < participants.length; ++i) {
            _net[groupId][participants[i]] -= _toInt(shares[i]);
        }
        emit ExpenseRecorded(
            groupId, expenseId, msg.sender, amount, splitType, participants, shares, description
        );
    }
}
