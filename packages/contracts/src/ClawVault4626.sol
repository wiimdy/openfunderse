// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IExecutionAdapter} from "./interfaces/IExecutionAdapter.sol";

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20PermitMinimal {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title ClawVault4626 (MVP+)
/// @notice Minimal ERC-4626 style vault with core-gated trade execution and native/WMON deposit path.
contract ClawVault4626 is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct TokenPosition {
        uint256 quantity;
        uint256 costBasisAsset;
    }

    struct PendingDeposit {
        address owner;
        address receiver;
        uint256 assets;
        uint64 queuedAt;
        uint8 status;
    }

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public guardian;
    address public core;
    address public asset;
    bool public paused;
    bool public configFrozen;
    bool public upgradesFrozen;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    mapping(address => bool) public isTokenAllowed;
    mapping(address => bool) public isAdapterAllowed;

    // Principal/profit accounting in asset units.
    mapping(address => uint256) public netDepositedAssets;
    uint256 public totalNetDepositedAssets;
    uint256 public cumulativeRealizedProfit;
    uint256 public cumulativeRealizedLoss;

    // Performance fee (on realized profit), minted as shares to avoid immediate asset outflow.
    uint16 public performanceFeeBps;
    address public performanceFeeRecipient;
    uint256 public openPositionCount;
    uint256 public pendingPerformanceFeeAssets;
    uint256 public nextDepositRequestId;

    mapping(address => TokenPosition) private tokenPositions;
    mapping(uint256 => PendingDeposit) public pendingDeposits;

    uint256 private locked;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint8 public constant DEPOSIT_REQUEST_PENDING = 1;
    uint8 public constant DEPOSIT_REQUEST_SETTLED = 2;
    uint8 public constant DEPOSIT_REQUEST_CANCELLED = 3;

    event CoreUpdated(address indexed core);
    event GuardianUpdated(address indexed guardian);
    event PauseUpdated(bool paused);
    event TokenAllowed(address indexed token, bool allowed);
    event AdapterAllowed(address indexed adapter, bool allowed);
    event PerformanceFeeUpdated(uint16 bps);
    event PerformanceFeeRecipientUpdated(address indexed recipient);
    event ConfigFrozen();
    event UpgradesFrozen();

    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event NativeDeposit(address indexed caller, address indexed receiver, uint256 nativeIn, uint256 shares);
    event NativeWithdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 nativeOut, uint256 shares);
    event TradeExecuted(
        bytes32 indexed intentHash,
        address indexed tokenIn,
        address indexed tokenOut,
        address adapter,
        uint256 amountIn,
        uint256 amountOut
    );
    event TradePnlRecorded(
        address indexed token,
        uint256 amountSold,
        uint256 proceedsInAsset,
        uint256 costPortionInAsset,
        uint256 realizedProfit,
        uint256 realizedLoss
    );
    event TokenPositionUpdated(address indexed token, uint256 quantity, uint256 costBasisAsset);
    event OpenPositionCountUpdated(address indexed token, uint256 openPositionCount);
    event PerformanceFeeAccrued(uint256 feeAssets, uint256 pendingFeeAssets);
    event PerformanceFeeMinted(address indexed recipient, uint256 feeAssets, uint256 feeShares);
    event DepositQueued(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 assets);
    event DepositQueueCancelled(uint256 indexed requestId, address indexed owner);
    event DepositQueueSettled(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 assets, uint256 shares);
    event VaultBalanceUpdated(address indexed token, uint256 tokenBalance, uint256 assetBalance, uint256 shareSupply);

    error NotOwner();
    error NotCore();
    error NotGuardian();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientShares();
    error TransferFailed();
    error TokenNotAllowed();
    error AdapterNotAllowed();
    error InsufficientTokenBalance();
    error OutputBelowMinimum();
    error VaultPaused();
    error ReentrancyDetected();
    error NativeOperationUnsupported();
    error InvalidNativeSender();
    error InvalidFeeBps();
    error ShareOpsBlockedWithOpenPositions();
    error UnsupportedTradePath();
    error InvalidDepositRequest();
    error NotDepositRequestOwner();
    error ConfigIsFrozen();
    error UpgradesAreFrozen();

    modifier onlyCore() {
        if (msg.sender != core) revert NotCore();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner() && msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier whenConfigMutable() {
        if (configFrozen) revert ConfigIsFrozen();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert ReentrancyDetected();
        locked = 2;
        _;
        locked = 1;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address asset_, string memory name_, string memory symbol_) external initializer {
        if (owner_ == address(0) || asset_ == address(0)) revert InvalidAddress();

        __Ownable_init(owner_);

        guardian = owner_;
        asset = asset_;
        name = name_;
        symbol = symbol_;
        performanceFeeRecipient = owner_;
        nextDepositRequestId = 1;
        locked = 1;

        isTokenAllowed[asset_] = true;

        emit GuardianUpdated(owner_);
        emit TokenAllowed(asset_, true);
        emit PerformanceFeeRecipientUpdated(owner_);
    }

    receive() external payable {
        if (msg.sender != asset) revert InvalidNativeSender();
    }

    function setCore(address newCore) external onlyOwner whenConfigMutable {
        if (newCore == address(0)) revert InvalidAddress();
        core = newCore;
        emit CoreUpdated(newCore);
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

    function setTokenAllowed(address token, bool allowed) external onlyOwner whenConfigMutable {
        if (token == address(0)) revert InvalidAddress();
        isTokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setAdapterAllowed(address adapter, bool allowed) external onlyOwner whenConfigMutable {
        if (adapter == address(0)) revert InvalidAddress();
        isAdapterAllowed[adapter] = allowed;
        emit AdapterAllowed(adapter, allowed);
    }

    function setPerformanceFeeBps(uint16 bps) external onlyOwner whenConfigMutable {
        if (bps > BPS_DENOMINATOR) revert InvalidFeeBps();
        performanceFeeBps = bps;
        emit PerformanceFeeUpdated(bps);
    }

    function setPerformanceFeeRecipient(address recipient) external onlyOwner whenConfigMutable {
        if (recipient == address(0)) revert InvalidAddress();
        performanceFeeRecipient = recipient;
        emit PerformanceFeeRecipientUpdated(recipient);
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

    function totalAssets() public view returns (uint256) {
        return IERC20Minimal(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        return _previewDepositGiven(assets, supply, managedAssets);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();

        if (supply == 0 || managedAssets == 0) return shares;
        return (shares * managedAssets) / supply;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        return _previewWithdrawGiven(assets, supply, managedAssets);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function maxDeposit(address) public view returns (uint256) {
        if (hasOpenPositions()) return 0;
        return type(uint256).max;
    }

    function maxMint(address) public view returns (uint256) {
        if (hasOpenPositions()) return 0;
        return type(uint256).max;
    }

    function maxWithdraw(address owner_) public view returns (uint256) {
        if (hasOpenPositions()) return 0;
        return convertToAssets(balanceOf[owner_]);
    }

    function maxRedeem(address owner_) public view returns (uint256) {
        if (hasOpenPositions()) return 0;
        return balanceOf[owner_];
    }

    function sharePriceX18() public view returns (uint256) {
        if (totalSupply == 0) return 1e18;
        return (totalAssets() * 1e18) / totalSupply;
    }

    function userAssetValue(address account) public view returns (uint256) {
        return convertToAssets(balanceOf[account]);
    }

    function userPerformance(address account)
        external
        view
        returns (uint256 shares, uint256 assetValue, uint256 principal, int256 pnl, uint256 ppsX18)
    {
        shares = balanceOf[account];
        assetValue = convertToAssets(shares);
        principal = netDepositedAssets[account];
        ppsX18 = sharePriceX18();
        pnl = _signedDiff(assetValue, principal);
    }

    function fundPerformance()
        external
        view
        returns (
            uint256 assetBalance,
            uint256 principal,
            int256 pnl,
            uint256 realizedProfit,
            uint256 realizedLoss,
            uint16 feeBps,
            address feeRecipient
        )
    {
        assetBalance = totalAssets();
        principal = totalNetDepositedAssets;
        pnl = _signedDiff(assetBalance, principal);
        realizedProfit = cumulativeRealizedProfit;
        realizedLoss = cumulativeRealizedLoss;
        feeBps = performanceFeeBps;
        feeRecipient = performanceFeeRecipient;
    }

    function getTokenPosition(address token) external view returns (uint256 quantity, uint256 costBasisAsset) {
        TokenPosition memory p = tokenPositions[token];
        quantity = p.quantity;
        costBasisAsset = p.costBasisAsset;
    }

    function hasOpenPositions() public view returns (bool) {
        return openPositionCount != 0;
    }

    function deposit(uint256 assets, address receiver) external payable nonReentrant returns (uint256 shares) {
        _requireNoOpenPositions();
        if (receiver == address(0)) revert InvalidAddress();

        if (msg.value != 0) {
            if (assets != 0 && assets != msg.value) revert InvalidAmount();
            return _depositNative(msg.value, receiver, msg.sender);
        }

        return _depositAsset(assets, receiver, msg.sender);
    }

    function depositNative(address receiver) external payable nonReentrant returns (uint256 shares) {
        _requireNoOpenPositions();
        if (receiver == address(0)) revert InvalidAddress();
        return _depositNative(msg.value, receiver, msg.sender);
    }

    function queueDeposit(uint256 assets, address receiver) external nonReentrant returns (uint256 requestId) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAddress();
        requestId = _queueDeposit(msg.sender, receiver, assets);
    }

    function queueDepositWithPermit(
        uint256 assets,
        address receiver,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 requestId) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAddress();

        IERC20PermitMinimal(asset).permit(msg.sender, address(this), assets, permitDeadline, v, r, s);
        requestId = _queueDeposit(msg.sender, receiver, assets);
    }

    function cancelQueuedDeposit(uint256 requestId) external nonReentrant {
        PendingDeposit storage d = pendingDeposits[requestId];
        if (d.status != DEPOSIT_REQUEST_PENDING) revert InvalidDepositRequest();
        if (d.owner != msg.sender) revert NotDepositRequestOwner();

        d.status = DEPOSIT_REQUEST_CANCELLED;
        emit DepositQueueCancelled(requestId, msg.sender);
    }

    function settleQueuedDeposits(uint256[] calldata requestIds) external nonReentrant returns (uint256 settledCount) {
        _requireNoOpenPositions();

        uint256 len = requestIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 requestId = requestIds[i];
            PendingDeposit storage d = pendingDeposits[requestId];
            if (d.status != DEPOSIT_REQUEST_PENDING) {
                continue;
            }

            uint256 shares = _previewDepositGiven(d.assets, totalSupply, totalAssets());
            if (shares == 0) shares = d.assets;

            if (!IERC20Minimal(asset).transferFrom(d.owner, address(this), d.assets)) revert TransferFailed();

            _mintShares(d.receiver, shares);
            _increasePrincipal(d.receiver, d.assets);

            d.status = DEPOSIT_REQUEST_SETTLED;
            settledCount += 1;

            emit Deposit(d.owner, d.receiver, d.assets, shares);
            emit DepositQueueSettled(requestId, d.owner, d.receiver, d.assets, shares);
            emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
        }
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 shares)
    {
        _requireNoOpenPositions();
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0) || owner_ == address(0)) revert InvalidAddress();
        if (owner_ != msg.sender) revert NotOwner();

        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        shares = _previewWithdrawGiven(assets, supply, managedAssets);
        if (balanceOf[owner_] < shares) revert InsufficientShares();

        _burnShares(owner_, shares);
        _decreasePrincipal(owner_, assets);

        if (!IERC20Minimal(asset).transfer(receiver, assets)) revert TransferFailed();

        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
        emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function withdrawNative(uint256 assets, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 shares)
    {
        _requireNoOpenPositions();
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0) || owner_ == address(0)) revert InvalidAddress();
        if (owner_ != msg.sender) revert NotOwner();

        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        shares = _previewWithdrawGiven(assets, supply, managedAssets);
        if (balanceOf[owner_] < shares) revert InsufficientShares();

        _burnShares(owner_, shares);
        _decreasePrincipal(owner_, assets);

        (bool ok,) = asset.call(abi.encodeWithSignature("withdraw(uint256)", assets));
        if (!ok) revert NativeOperationUnsupported();

        (bool sent,) = receiver.call{value: assets}("");
        if (!sent) revert TransferFailed();

        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
        emit NativeWithdraw(msg.sender, receiver, owner_, assets, shares);
        emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 assets)
    {
        _requireNoOpenPositions();
        if (shares == 0) revert InvalidAmount();
        if (receiver == address(0) || owner_ == address(0)) revert InvalidAddress();
        if (owner_ != msg.sender) revert NotOwner();
        if (balanceOf[owner_] < shares) revert InsufficientShares();

        assets = convertToAssets(shares);
        if (assets == 0) revert InvalidAmount();

        _burnShares(owner_, shares);
        _decreasePrincipal(owner_, assets);

        if (!IERC20Minimal(asset).transfer(receiver, assets)) revert TransferFailed();

        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
        emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function executeTrade(
        bytes32 intentHash,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) external onlyCore nonReentrant returns (uint256 amountOut) {
        if (paused) revert VaultPaused();
        if (!isTokenAllowed[tokenIn] || !isTokenAllowed[tokenOut]) revert TokenNotAllowed();
        if (!isAdapterAllowed[adapter]) revert AdapterNotAllowed();
        if (amountIn == 0) revert InvalidAmount();
        if (tokenIn != asset && tokenOut != asset) revert UnsupportedTradePath();

        uint256 tokenInBalance = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (tokenInBalance < amountIn) revert InsufficientTokenBalance();

        uint256 beforeOut = IERC20Minimal(tokenOut).balanceOf(address(this));

        if (!IERC20Minimal(tokenIn).transfer(adapter, amountIn)) revert TransferFailed();

        uint256 adapterReportedOut = IExecutionAdapter(adapter).execute(address(this), tokenIn, tokenOut, amountIn, data);

        uint256 afterOut = IERC20Minimal(tokenOut).balanceOf(address(this));
        uint256 deltaOut = afterOut - beforeOut;
        if (deltaOut < minAmountOut || adapterReportedOut < minAmountOut) revert OutputBelowMinimum();

        _recordTradePnl(tokenIn, tokenOut, amountIn, deltaOut);
        _settlePendingPerformanceFeesIfReady();

        amountOut = deltaOut;
        emit TradeExecuted(intentHash, tokenIn, tokenOut, adapter, amountIn, amountOut);
        emit VaultBalanceUpdated(tokenOut, IERC20Minimal(tokenOut).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function _recordTradePnl(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) internal {
        // Buy path: asset -> non-asset token. Track inventory cost basis in asset units.
        if (tokenIn == asset && tokenOut != asset) {
            TokenPosition storage p = tokenPositions[tokenOut];
            uint256 prevQty = p.quantity;
            p.quantity += amountOut;
            p.costBasisAsset += amountIn;
            if (prevQty == 0 && p.quantity > 0) {
                openPositionCount += 1;
                emit OpenPositionCountUpdated(tokenOut, openPositionCount);
            }
            emit TokenPositionUpdated(tokenOut, p.quantity, p.costBasisAsset);
            return;
        }

        // Sell path: non-asset token -> asset. Realize PnL against tracked cost basis.
        if (tokenOut == asset && tokenIn != asset) {
            TokenPosition storage p = tokenPositions[tokenIn];
            uint256 priorQty = p.quantity;
            uint256 matchedQty = amountIn <= priorQty ? amountIn : priorQty;
            uint256 costPortion = 0;
            uint256 matchedProceeds = 0;

            if (matchedQty > 0 && priorQty > 0) {
                costPortion = (p.costBasisAsset * matchedQty) / priorQty;
                p.quantity = priorQty - matchedQty;
                p.costBasisAsset -= costPortion;
                if (p.quantity == 0 && openPositionCount > 0) {
                    openPositionCount -= 1;
                    emit OpenPositionCountUpdated(tokenIn, openPositionCount);
                }
                emit TokenPositionUpdated(tokenIn, p.quantity, p.costBasisAsset);
                matchedProceeds = (amountOut * matchedQty) / amountIn;
            }

            uint256 realizedProfit = 0;
            uint256 realizedLoss = 0;
            if (matchedProceeds >= costPortion) {
                realizedProfit = matchedProceeds - costPortion;
                cumulativeRealizedProfit += realizedProfit;
                _accruePerformanceFeeAssets(realizedProfit);
            } else {
                realizedLoss = costPortion - matchedProceeds;
                cumulativeRealizedLoss += realizedLoss;
            }

            emit TradePnlRecorded(tokenIn, amountIn, matchedProceeds, costPortion, realizedProfit, realizedLoss);
        }
    }

    function _accruePerformanceFeeAssets(uint256 realizedProfit) internal {
        if (realizedProfit == 0 || performanceFeeBps == 0 || performanceFeeRecipient == address(0)) {
            return;
        }

        uint256 feeAssets = (realizedProfit * performanceFeeBps) / BPS_DENOMINATOR;
        if (feeAssets == 0) {
            return;
        }

        pendingPerformanceFeeAssets += feeAssets;
        emit PerformanceFeeAccrued(feeAssets, pendingPerformanceFeeAssets);
    }

    function _settlePendingPerformanceFeesIfReady() internal {
        if (hasOpenPositions()) {
            return;
        }

        uint256 feeAssets = pendingPerformanceFeeAssets;
        if (feeAssets == 0) {
            return;
        }

        if (_mintPerformanceFeeSharesFromFeeAssets(feeAssets)) {
            pendingPerformanceFeeAssets = 0;
        }
    }

    function _mintPerformanceFeeSharesFromFeeAssets(uint256 feeAssets) internal returns (bool minted) {
        uint256 feeShares = _previewDepositGiven(feeAssets, totalSupply, totalAssets());
        if (feeShares == 0) {
            return false;
        }

        _mintShares(performanceFeeRecipient, feeShares);
        emit PerformanceFeeMinted(performanceFeeRecipient, feeAssets, feeShares);
        return true;
    }

    function _mintShares(address to, uint256 shares) internal {
        totalSupply += shares;
        balanceOf[to] += shares;
    }

    function _burnShares(address from, uint256 shares) internal {
        balanceOf[from] -= shares;
        totalSupply -= shares;
    }

    function _increasePrincipal(address account, uint256 assets) internal {
        netDepositedAssets[account] += assets;
        totalNetDepositedAssets += assets;
    }

    function _decreasePrincipal(address account, uint256 assets) internal {
        uint256 current = netDepositedAssets[account];
        uint256 delta = assets <= current ? assets : current;
        if (delta == 0) return;

        netDepositedAssets[account] = current - delta;
        totalNetDepositedAssets -= delta;
    }

    function _queueDeposit(address owner_, address receiver, uint256 assets) internal returns (uint256 requestId) {
        requestId = nextDepositRequestId;
        nextDepositRequestId = requestId + 1;

        pendingDeposits[requestId] = PendingDeposit({
            owner: owner_,
            receiver: receiver,
            assets: assets,
            queuedAt: uint64(block.timestamp),
            status: DEPOSIT_REQUEST_PENDING
        });

        emit DepositQueued(requestId, owner_, receiver, assets);
    }

    function _depositAsset(uint256 assets, address receiver, address caller) internal returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();

        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        shares = _previewDepositGiven(assets, supply, managedAssets);
        if (shares == 0) shares = assets;

        if (!IERC20Minimal(asset).transferFrom(caller, address(this), assets)) revert TransferFailed();

        _mintShares(receiver, shares);
        _increasePrincipal(receiver, assets);

        emit Deposit(caller, receiver, assets, shares);
        emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function _depositNative(uint256 assets, address receiver, address caller) internal returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();

        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();
        shares = _previewDepositGiven(assets, supply, managedAssets);
        if (shares == 0) shares = assets;

        (bool ok,) = asset.call{value: assets}(abi.encodeWithSignature("deposit()"));
        if (!ok) revert NativeOperationUnsupported();

        _mintShares(receiver, shares);
        _increasePrincipal(receiver, assets);

        emit Deposit(caller, receiver, assets, shares);
        emit NativeDeposit(caller, receiver, assets, shares);
        emit VaultBalanceUpdated(asset, IERC20Minimal(asset).balanceOf(address(this)), totalAssets(), totalSupply);
    }

    function _previewDepositGiven(uint256 assets, uint256 supply, uint256 managedAssets) internal pure returns (uint256) {
        if (supply == 0 || managedAssets == 0) return assets;
        return (assets * supply) / managedAssets;
    }

    function _previewWithdrawGiven(uint256 assets, uint256 supply, uint256 managedAssets) internal pure returns (uint256) {
        if (supply == 0 || managedAssets == 0) return assets;
        return (assets * supply + managedAssets - 1) / managedAssets;
    }

    function _signedDiff(uint256 left, uint256 right) internal pure returns (int256) {
        if (left >= right) return int256(left - right);
        return -int256(right - left);
    }

    function _requireNoOpenPositions() internal view {
        if (hasOpenPositions()) revert ShareOpsBlockedWithOpenPositions();
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
    }

    uint256[50] private __gap;
}
