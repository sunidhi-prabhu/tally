// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @notice TEST-ONLY ERC-20. Not Agora AUSD and not deployed anywhere.
/// Behaves like a plain 6-decimal token by default; `setMode` switches on misbehaviour used to
/// test TallyLedger's token handling.
contract MockToken {
    enum Mode {
        Standard,
        /// `transferFrom` succeeds but returns no data (USDT-style).
        NoReturnData,
        /// `transferFrom` returns false without moving tokens or reverting.
        ReturnsFalse,
        /// The recipient receives `amount - 1`.
        FeeOnTransfer,
        /// Calls `reentryTarget` with `reentryData` during `transferFrom`, then transfers.
        Reentrant
    }

    error InsufficientBalance(address account, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    string public constant name = "Mock Token (test only)";
    string public constant symbol = "MOCK";
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    Mode public mode;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (mode == Mode.ReturnsFalse) return false;

        if (mode == Mode.Reentrant && reentryTarget != address(0)) {
            reentryAttempted = true;
            (bool ok, bytes memory data) = reentryTarget.call(reentryData);
            reentrySucceeded = ok;
            reentryRevertData = data;
        }

        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;

        _move(from, to, amount, mode == Mode.FeeOnTransfer ? amount - 1 : amount);

        if (mode == Mode.NoReturnData) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }

    function _move(address from, address to, uint256 debit, uint256 credit) private {
        uint256 balance = balanceOf[from];
        if (balance < debit) revert InsufficientBalance(from, balance, debit);
        balanceOf[from] = balance - debit;
        balanceOf[to] += credit;
        totalSupply -= debit - credit;
        emit Transfer(from, to, credit);
    }
}
