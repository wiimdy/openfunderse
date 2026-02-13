// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IExecutionAdapter {
    /// @notice Execute a trade using tokens already transferred into adapter.
    /// @param vault Vault address where output token should be delivered.
    /// @param tokenIn Input token address.
    /// @param tokenOut Output token address.
    /// @param amountIn Input amount.
    /// @param data Adapter-specific route payload.
    /// @return amountOut Actual amount of tokenOut sent to vault.
    function execute(address vault, address tokenIn, address tokenOut, uint256 amountIn, bytes calldata data)
        external
        returns (uint256 amountOut);
}
