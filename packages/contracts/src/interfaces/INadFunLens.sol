// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title INadFunLens
/// @notice Minimal quote interface for NadFun buy/sell dry-run checks.
interface INadFunLens {
    /// @param token NadFun token address
    /// @param amountIn Input amount (MON for buy path, token amount for sell path)
    /// @param isBuy True for buy quote, false for sell quote
    /// @return router Router address selected by NadFun
    /// @return amountOut Quoted output amount
    function getAmountOut(address token, uint256 amountIn, bool isBuy) external view returns (address router, uint256 amountOut);
}
