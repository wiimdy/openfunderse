// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IExecutionAdapterQuote {
    /// @notice Best-effort quote path for dry-run validation.
    /// @param lens Quote source contract (e.g. NadFun lens)
    /// @param tokenIn Input token
    /// @param tokenOut Output token
    /// @param amountIn Input amount
    /// @param data Adapter-specific execution payload
    /// @return ok Whether quote succeeded
    /// @return expectedAmountOut Quoted output amount
    /// @return reasonCode Short reason code for diagnostics
    function quote(address lens, address tokenIn, address tokenOut, uint256 amountIn, bytes calldata data)
        external
        view
        returns (bool ok, uint256 expectedAmountOut, bytes32 reasonCode);
}
