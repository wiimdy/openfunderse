// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ClawVault4626} from "./ClawVault4626.sol";
import {IExecutionAdapterQuote} from "./interfaces/IExecutionAdapterQuote.sol";

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
contract ClawCore is Initializable, OwnableUpgradeable, UUPSUpgradeable {
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

    struct DryRunResult {
        bool exists;
        bool approved;
        bool notExpired;
        bool notExecuted;
        bool withinNotional;
        bool slippageOk;
        bool allowlistOk;
        bool coreNotPaused;
        bool vaultNotPaused;
        bool tokenInAllowed;
        bool tokenOutAllowed;
        bool adapterAllowed;
        bool lensConfigured;
        bool quoteOk;
        bytes32 snapshotHash;
        uint64 deadline;
        uint16 maxSlippageBps;
        uint256 maxNotional;
        uint256 expectedAmountOut;
        bytes32 expectedAllowlistHash;
        bytes32 computedAllowlistHash;
        bytes32 quoteReasonCode;
        bytes32 failureCode;
    }

    address public guardian;
    IIntentBookExecutionView public intentBook;
    ClawVault4626 public vault;
    address public nadfunLens;
    bool public paused;
    bool public configFrozen;
    bool public upgradesFrozen;

    mapping(bytes32 => bool) public executedIntent;

    event IntentBookUpdated(address indexed intentBook);
    event VaultUpdated(address indexed vault);
    event NadfunLensUpdated(address indexed lens);
    event GuardianUpdated(address indexed guardian);
    event PauseUpdated(bool paused);
    event ConfigFrozen();
    event UpgradesFrozen();
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
    error ConfigIsFrozen();
    error UpgradesAreFrozen();

    bytes32 private constant DRYRUN_OK = "OK";
    bytes32 private constant DRYRUN_CORE_PAUSED = "CORE_PAUSED";
    bytes32 private constant DRYRUN_INTENT_NOT_FOUND = "INTENT_NOT_FOUND";
    bytes32 private constant DRYRUN_INTENT_NOT_APPROVED = "INTENT_NOT_APPROVED";
    bytes32 private constant DRYRUN_INTENT_EXPIRED = "INTENT_EXPIRED";
    bytes32 private constant DRYRUN_INTENT_ALREADY_EXECUTED = "INTENT_ALREADY_EXECUTED";
    bytes32 private constant DRYRUN_MAX_NOTIONAL_EXCEEDED = "MAX_NOTIONAL_EXCEEDED";
    bytes32 private constant DRYRUN_SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED";
    bytes32 private constant DRYRUN_ALLOWLIST_VIOLATION = "ALLOWLIST_VIOLATION";
    bytes32 private constant DRYRUN_VAULT_PAUSED = "VAULT_PAUSED";
    bytes32 private constant DRYRUN_TOKEN_IN_NOT_ALLOWED = "TOKEN_IN_NOT_ALLOWED";
    bytes32 private constant DRYRUN_TOKEN_OUT_NOT_ALLOWED = "TOKEN_OUT_NOT_ALLOWED";
    bytes32 private constant DRYRUN_ADAPTER_NOT_ALLOWED = "ADAPTER_NOT_ALLOWED";
    bytes32 private constant DRYRUN_LENS_NOT_CONFIGURED = "LENS_NOT_CONFIGURED";
    bytes32 private constant DRYRUN_QUOTE_CALL_FAILED = "QUOTE_CALL_FAILED";
    bytes32 private constant DRYRUN_QUOTE_FAILED = "QUOTE_FAILED";
    bytes32 private constant DRYRUN_QUOTE_BELOW_MIN = "QUOTE_BELOW_MIN";
    bytes32 private constant DRYRUN_QUOTE_SKIPPED = "QUOTE_SKIPPED";

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner() && msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier whenConfigMutable() {
        if (configFrozen) revert ConfigIsFrozen();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address intentBook_, address vault_) external initializer {
        if (owner_ == address(0) || intentBook_ == address(0) || vault_ == address(0)) revert InvalidAddress();

        __Ownable_init(owner_);

        guardian = owner_;
        intentBook = IIntentBookExecutionView(intentBook_);
        vault = ClawVault4626(payable(vault_));

        emit GuardianUpdated(owner_);
        emit IntentBookUpdated(intentBook_);
        emit VaultUpdated(vault_);
    }

    function setIntentBook(address newIntentBook) external onlyOwner whenConfigMutable {
        if (newIntentBook == address(0)) revert InvalidAddress();
        intentBook = IIntentBookExecutionView(newIntentBook);
        emit IntentBookUpdated(newIntentBook);
    }

    function setVault(address newVault) external onlyOwner whenConfigMutable {
        if (newVault == address(0)) revert InvalidAddress();
        vault = ClawVault4626(payable(newVault));
        emit VaultUpdated(newVault);
    }

    function setNadfunLens(address newLens) external onlyOwner whenConfigMutable {
        if (newLens == address(0)) revert InvalidAddress();
        nadfunLens = newLens;
        emit NadfunLensUpdated(newLens);
    }

    function setGuardian(address newGuardian) external onlyOwner whenConfigMutable {
        if (newGuardian == address(0)) revert InvalidAddress();
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function setPaused(bool paused_) external onlyOwnerOrGuardian {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function freezeConfig() external onlyOwner {
        if (configFrozen) revert ConfigIsFrozen();
        configFrozen = true;
        emit ConfigFrozen();
    }

    function freezeUpgrades() external onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
        upgradesFrozen = true;
        emit UpgradesFrozen();
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

    function dryRunIntentExecution(bytes32 intentHash, ExecutionRequest calldata req)
        external
        view
        returns (DryRunResult memory r)
    {
        ExecutionValidation memory v = validateIntentExecution(intentHash, req);

        r.exists = v.exists;
        r.approved = v.approved;
        r.notExpired = v.notExpired;
        r.notExecuted = v.notExecuted;
        r.withinNotional = v.withinNotional;
        r.slippageOk = v.slippageOk;
        r.allowlistOk = v.allowlistOk;
        r.snapshotHash = v.snapshotHash;
        r.deadline = v.deadline;
        r.maxSlippageBps = v.maxSlippageBps;
        r.maxNotional = v.maxNotional;
        r.expectedAllowlistHash = v.expectedAllowlistHash;
        r.computedAllowlistHash = v.computedAllowlistHash;

        r.coreNotPaused = !paused;
        r.vaultNotPaused = !vault.paused();
        r.tokenInAllowed = vault.isTokenAllowed(req.tokenIn);
        r.tokenOutAllowed = vault.isTokenAllowed(req.tokenOut);
        r.adapterAllowed = vault.isAdapterAllowed(req.adapter);
        r.lensConfigured = nadfunLens != address(0);

        if (_policyChecksPass(r)) {
            if (!r.lensConfigured) {
                r.quoteOk = false;
                r.quoteReasonCode = DRYRUN_LENS_NOT_CONFIGURED;
            } else {
                try IExecutionAdapterQuote(req.adapter).quote(
                    nadfunLens, req.tokenIn, req.tokenOut, req.amountIn, req.adapterData
                ) returns (bool ok, uint256 expectedOut, bytes32 reasonCode) {
                    r.quoteOk = ok;
                    r.expectedAmountOut = expectedOut;
                    r.quoteReasonCode = reasonCode;
                } catch {
                    r.quoteOk = false;
                    r.quoteReasonCode = DRYRUN_QUOTE_CALL_FAILED;
                }
            }
        } else {
            r.quoteOk = false;
            r.quoteReasonCode = DRYRUN_QUOTE_SKIPPED;
        }

        r.failureCode = _dryRunFailureCode(r, req.minAmountOut);
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

    function _policyChecksPass(DryRunResult memory r) internal pure returns (bool) {
        return r.coreNotPaused && r.exists && r.approved && r.notExpired && r.notExecuted && r.withinNotional
            && r.slippageOk && r.allowlistOk && r.vaultNotPaused && r.tokenInAllowed && r.tokenOutAllowed
            && r.adapterAllowed;
    }

    function _dryRunFailureCode(DryRunResult memory r, uint256 minAmountOut) internal pure returns (bytes32) {
        if (!r.coreNotPaused) return DRYRUN_CORE_PAUSED;
        if (!r.exists) return DRYRUN_INTENT_NOT_FOUND;
        if (!r.approved) return DRYRUN_INTENT_NOT_APPROVED;
        if (!r.notExpired) return DRYRUN_INTENT_EXPIRED;
        if (!r.notExecuted) return DRYRUN_INTENT_ALREADY_EXECUTED;
        if (!r.withinNotional) return DRYRUN_MAX_NOTIONAL_EXCEEDED;
        if (!r.slippageOk) return DRYRUN_SLIPPAGE_EXCEEDED;
        if (!r.allowlistOk) return DRYRUN_ALLOWLIST_VIOLATION;
        if (!r.vaultNotPaused) return DRYRUN_VAULT_PAUSED;
        if (!r.tokenInAllowed) return DRYRUN_TOKEN_IN_NOT_ALLOWED;
        if (!r.tokenOutAllowed) return DRYRUN_TOKEN_OUT_NOT_ALLOWED;
        if (!r.adapterAllowed) return DRYRUN_ADAPTER_NOT_ALLOWED;
        if (!r.lensConfigured) return DRYRUN_LENS_NOT_CONFIGURED;
        if (!r.quoteOk) return DRYRUN_QUOTE_FAILED;
        if (r.expectedAmountOut < minAmountOut) return DRYRUN_QUOTE_BELOW_MIN;
        return DRYRUN_OK;
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
    }

    uint256[50] private __gap;
}
