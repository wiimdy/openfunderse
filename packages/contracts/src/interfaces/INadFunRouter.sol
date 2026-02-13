// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title INadFunRouter
/// @notice Minimal NadFun router interface used by execution adapters.
interface INadFunRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    struct SellParams {
        uint256 amountIn;
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buy(BuyParams calldata params) external payable;
    function sell(SellParams calldata params) external;
}
