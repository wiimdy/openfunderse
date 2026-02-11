// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ClawVault4626} from "./ClawVault4626.sol";

interface IIntentBookExecutionView {
    function isIntentApproved(bytes32 intentHash) external view returns (bool);

    function getIntentExecutionData(bytes32 intentHash)
        external
        view
        returns (
            bool exists,
            bool approved,
            bytes32 snapshotHash,
            uint64 deadline,
            uint16 maxSlippageBps,
            uint256 maxNotional,
            bytes32 allowlistHash
        );
}

/// @title ClawCore
/// @notice Settlement orchestrator: verifies approved intent constraints then executes trade through vault adapter.
contract ClawCore {
    struct ExecutionRequest {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 quoteAmountOut;
        uint256 minAmountOut;
        address adapter;
        bytes adapterData;
    }

    struct ExecutionValidation {
        bool exists;
        bool approved;
        bool notExpired;
        bool notExecuted;
        bool withinNotional;
        bool slippageOk;
        bool allowlistOk;
        bytes32 snapshotHash;
        uint64 deadline;
        uint16 maxSlippageBps;
        uint256 maxNotional;
        bytes32 expectedAllowlistHash;
        bytes32 computedAllowlistHash;
    }

    address public owner;
    address public guardian;
    IIntentBookExecutionView public intentBook;
    ClawVault4626 public vault;
    bool public paused;

    mapping(bytes32 => bool) public executedIntent;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IntentBookUpdated(address indexed intentBook);
    event VaultUpdated(address indexed vault);
    event GuardianUpdated(address indexed guardian);
    event PauseUpdated(bool paused);
    event IntentExecuted(
        bytes32 indexed intentHash,
        bytes32 indexed snapshotHash,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        uint256 amountOut
    );

    error NotOwner();
    error InvalidAddress();
    error NotGuardian();
    error IntentNotFound();
    error IntentNotApproved();
    error IntentExpired();
    error IntentAlreadyExecuted();
    error MaxNotionalExceeded();
    error SlippageExceeded();
    error AllowlistViolation();
    error CorePaused();
    error InvalidSlippageConfig();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address owner_, address intentBook_, address vault_) {
        if (owner_ == address(0) || intentBook_ == address(0) || vault_ == address(0)) revert InvalidAddress();

        owner = owner_;
        guardian = owner_;
        intentBook = IIntentBookExecutionView(intentBook_);
        vault = ClawVault4626(vault_);

        emit OwnershipTransferred(address(0), owner_);
        emit GuardianUpdated(owner_);
        emit IntentBookUpdated(intentBook_);
        emit VaultUpdated(vault_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setIntentBook(address newIntentBook) external onlyOwner {
        if (newIntentBook == address(0)) revert InvalidAddress();
        intentBook = IIntentBookExecutionView(newIntentBook);
        emit IntentBookUpdated(newIntentBook);
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert InvalidAddress();
        vault = ClawVault4626(newVault);
        emit VaultUpdated(newVault);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert InvalidAddress();
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function setPaused(bool paused_) external onlyOwnerOrGuardian {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function executeIntent(
        bytes32 intentHash,
        ExecutionRequest calldata req
    ) external returns (uint256 amountOut) {
        if (paused) revert CorePaused();
        ExecutionValidation memory v = validateIntentExecution(intentHash, req);
        if (!v.exists) revert IntentNotFound();
        if (!v.approved) revert IntentNotApproved();
        if (!v.notExpired) revert IntentExpired();
        if (!v.notExecuted) revert IntentAlreadyExecuted();
        if (!v.withinNotional) revert MaxNotionalExceeded();
        if (!v.slippageOk) revert SlippageExceeded();
        if (!v.allowlistOk) revert AllowlistViolation();

        amountOut = vault.executeTrade(
            intentHash, req.tokenIn, req.tokenOut, req.amountIn, req.minAmountOut, req.adapter, req.adapterData
        );

        executedIntent[intentHash] = true;

        emit IntentExecuted(
            intentHash, v.snapshotHash, req.tokenIn, req.tokenOut, req.amountIn, req.minAmountOut, req.adapter, amountOut
        );
    }

    /// @notice Preflight validator for intent execution.
    /// @dev Use this via eth_call to check whether a custom execution request is currently valid.
    function validateIntentExecution(
        bytes32 intentHash,
        ExecutionRequest calldata req
    ) public view returns (ExecutionValidation memory v) {
        (
            bool exists,
            bool approved,
            bytes32 snapshotHash,
            uint64 deadline,
            uint16 maxSlippageBps,
            uint256 maxNotional,
            bytes32 allowlistHash
        ) = intentBook.getIntentExecutionData(intentHash);

        v.exists = exists;
        v.approved = approved && intentBook.isIntentApproved(intentHash);
        v.snapshotHash = snapshotHash;
        v.deadline = deadline;
        v.maxSlippageBps = maxSlippageBps;
        v.maxNotional = maxNotional;
        v.notExpired = deadline > block.timestamp;
        v.notExecuted = !executedIntent[intentHash];
        v.withinNotional = (maxNotional == 0 || req.amountIn <= maxNotional);
        v.slippageOk = _isSlippageOk(maxSlippageBps, req.quoteAmountOut, req.minAmountOut);
        v.expectedAllowlistHash = allowlistHash;
        v.allowlistOk = true;

        // Allowlist convention:
        // allowlistHash ==
        // keccak256(abi.encode(tokenIn, tokenOut, quoteAmountOut, minAmountOut, adapter, keccak256(adapterData)))
        // This binds route + adapter call payload to the approved intent.
        if (allowlistHash != bytes32(0)) {
            v.computedAllowlistHash = keccak256(
                abi.encode(req.tokenIn, req.tokenOut, req.quoteAmountOut, req.minAmountOut, req.adapter, keccak256(req.adapterData))
            );
            v.allowlistOk = (v.computedAllowlistHash == allowlistHash);
        }
    }

    function _isSlippageOk(uint16 maxSlippageBps, uint256 quoteAmountOut, uint256 minAmountOut)
        internal
        pure
        returns (bool)
    {
        if (maxSlippageBps > 10_000) revert InvalidSlippageConfig();
        if (quoteAmountOut == 0 || minAmountOut == 0) return false;

        uint256 minRequired = (quoteAmountOut * (10_000 - maxSlippageBps)) / 10_000;
        return minAmountOut >= minRequired;
    }
}
