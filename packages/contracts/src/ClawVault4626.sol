// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IExecutionAdapter} from "./interfaces/IExecutionAdapter.sol";

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title ClawVault4626 (MVP)
/// @notice Minimal ERC-4626 style vault with core-gated trade execution.
contract ClawVault4626 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public owner;
    address public core;
    address public immutable asset;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    mapping(address => bool) public isTokenAllowed;
    mapping(address => bool) public isAdapterAllowed;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CoreUpdated(address indexed core);
    event TokenAllowed(address indexed token, bool allowed);
    event AdapterAllowed(address indexed adapter, bool allowed);

    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event TradeExecuted(
        bytes32 indexed intentHash,
        address indexed tokenIn,
        address indexed tokenOut,
        address adapter,
        uint256 amountIn,
        uint256 amountOut
    );

    error NotOwner();
    error NotCore();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientShares();
    error TransferFailed();
    error TokenNotAllowed();
    error AdapterNotAllowed();
    error InsufficientTokenBalance();
    error OutputBelowMinimum();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert NotCore();
        _;
    }

    constructor(address owner_, address asset_, string memory name_, string memory symbol_) {
        if (owner_ == address(0) || asset_ == address(0)) revert InvalidAddress();
        owner = owner_;
        asset = asset_;
        name = name_;
        symbol = symbol_;

        isTokenAllowed[asset_] = true;

        emit OwnershipTransferred(address(0), owner_);
        emit TokenAllowed(asset_, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCore(address newCore) external onlyOwner {
        if (newCore == address(0)) revert InvalidAddress();
        core = newCore;
        emit CoreUpdated(newCore);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        isTokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setAdapterAllowed(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0)) revert InvalidAddress();
        isAdapterAllowed[adapter] = allowed;
        emit AdapterAllowed(adapter, allowed);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20Minimal(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 managedAssets = totalAssets();

        if (supply == 0 || managedAssets == 0) return assets;
        return (assets * supply) / managedAssets;
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
        if (supply == 0 || managedAssets == 0) return assets;
        return (assets * supply + managedAssets - 1) / managedAssets;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAddress();

        shares = previewDeposit(assets);
        if (shares == 0) shares = assets;

        if (!IERC20Minimal(asset).transferFrom(msg.sender, address(this), assets)) revert TransferFailed();

        totalSupply += shares;
        balanceOf[receiver] += shares;

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner_) external returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0) || owner_ == address(0)) revert InvalidAddress();
        if (owner_ != msg.sender) revert NotOwner();

        shares = previewWithdraw(assets);
        if (balanceOf[owner_] < shares) revert InsufficientShares();

        balanceOf[owner_] -= shares;
        totalSupply -= shares;

        if (!IERC20Minimal(asset).transfer(receiver, assets)) revert TransferFailed();

        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    function executeTrade(
        bytes32 intentHash,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) external onlyCore returns (uint256 amountOut) {
        if (!isTokenAllowed[tokenIn] || !isTokenAllowed[tokenOut]) revert TokenNotAllowed();
        if (!isAdapterAllowed[adapter]) revert AdapterNotAllowed();
        if (amountIn == 0) revert InvalidAmount();

        uint256 tokenInBalance = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (tokenInBalance < amountIn) revert InsufficientTokenBalance();

        uint256 beforeOut = IERC20Minimal(tokenOut).balanceOf(address(this));

        if (!IERC20Minimal(tokenIn).transfer(adapter, amountIn)) revert TransferFailed();

        amountOut = IExecutionAdapter(adapter).execute(address(this), tokenIn, tokenOut, amountIn, data);

        uint256 afterOut = IERC20Minimal(tokenOut).balanceOf(address(this));
        uint256 deltaOut = afterOut - beforeOut;
        if (deltaOut < minAmountOut || amountOut < minAmountOut) revert OutputBelowMinimum();

        emit TradeExecuted(intentHash, tokenIn, tokenOut, adapter, amountIn, deltaOut);
    }
}
