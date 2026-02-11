// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";

interface IWMon {
    function withdraw(uint256 amount) external;
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface INadFunRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buy(BuyParams calldata params) external payable;

    struct SellParams {
        uint256 amountIn;
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function sell(SellParams calldata params) external;
}

/// @title NadfunExecutionAdapter
/// @notice Real execution adapter for NadFun router buy path using WMON->MON unwrap.
contract NadfunExecutionAdapter is IExecutionAdapter {
    struct NadfunExecutionDataV1 {
        uint8 version;
        uint8 action; // 1=BUY, 2=SELL (MVP supports BUY only)
        uint8 venue; // 1=bonding curve, 2=dex
        address router;
        address recipient;
        address token;
        uint64 deadline;
        uint256 amountOutMin;
        bytes extra;
    }

    address public immutable wmon;
    address public immutable bondingCurveRouter;
    address public immutable dexRouter;

    event NadfunBuyExecuted(address indexed router, address indexed token, uint256 amountIn, uint256 amountOut, address indexed recipient);

    error UnsupportedAction();
    error InvalidExecutionData();
    error DeadlineExpired();
    error InvalidTokenIn();
    error UnsupportedRouter();
    error WrapFailed();

    constructor(address wmon_, address bondingCurveRouter_, address dexRouter_) {
        if (wmon_ == address(0) || bondingCurveRouter_ == address(0) || dexRouter_ == address(0)) {
            revert InvalidExecutionData();
        }
        wmon = wmon_;
        bondingCurveRouter = bondingCurveRouter_;
        dexRouter = dexRouter_;
    }

    receive() external payable {}

    function execute(address vault, address tokenIn, address tokenOut, uint256 amountIn, bytes calldata data)
        external
        returns (uint256 amountOut)
    {
        NadfunExecutionDataV1 memory decoded = _decode(data);
        if (decoded.version != 1) revert InvalidExecutionData();
        if (decoded.action == 1) {
            amountOut = _executeBuy(vault, tokenIn, tokenOut, amountIn, decoded);
        } else if (decoded.action == 2) {
            amountOut = _executeSell(vault, tokenIn, tokenOut, amountIn, decoded);
        } else {
            revert UnsupportedAction();
        }
    }

    function _executeBuy(address vault, address tokenIn, address tokenOut, uint256 amountIn, NadfunExecutionDataV1 memory decoded)
        internal
        returns (uint256 amountOut)
    {
        if (tokenIn != wmon) revert InvalidTokenIn();
        if (decoded.recipient != vault || decoded.token != tokenOut) revert InvalidExecutionData();
        if (decoded.deadline < block.timestamp) revert DeadlineExpired();
        if (decoded.router != bondingCurveRouter && decoded.router != dexRouter) revert UnsupportedRouter();

        IWMon(wmon).withdraw(amountIn);

        uint256 beforeOut = IERC20Balance(tokenOut).balanceOf(vault);

        INadFunRouter.BuyParams memory params = INadFunRouter.BuyParams({
            amountOutMin: decoded.amountOutMin,
            token: decoded.token,
            to: decoded.recipient,
            deadline: decoded.deadline
        });

        INadFunRouter(decoded.router).buy{value: amountIn}(params);
        uint256 afterOut = IERC20Balance(tokenOut).balanceOf(vault);
        amountOut = afterOut - beforeOut;
        emit NadfunBuyExecuted(decoded.router, decoded.token, amountIn, amountOut, decoded.recipient);
    }

    function _executeSell(
        address vault,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        NadfunExecutionDataV1 memory decoded
    ) internal returns (uint256 amountOut) {
        if (decoded.token != tokenIn) revert InvalidExecutionData();
        if (tokenOut != wmon) revert InvalidTokenIn();
        if (decoded.recipient != address(this)) revert InvalidExecutionData();
        if (decoded.deadline < block.timestamp) revert DeadlineExpired();
        if (decoded.router != bondingCurveRouter && decoded.router != dexRouter) revert UnsupportedRouter();

        if (!IERC20Balance(tokenIn).approve(decoded.router, amountIn)) revert InvalidExecutionData();
        uint256 beforeNative = address(this).balance;

        INadFunRouter.SellParams memory params = INadFunRouter.SellParams({
            amountIn: amountIn,
            amountOutMin: decoded.amountOutMin,
            token: decoded.token,
            to: decoded.recipient,
            deadline: decoded.deadline
        });

        INadFunRouter(decoded.router).sell(params);

        uint256 nativeDelta = address(this).balance - beforeNative;
        IWMon(wmon).deposit{value: nativeDelta}();
        if (!IWMon(wmon).transfer(vault, nativeDelta)) revert WrapFailed();
        amountOut = nativeDelta;
        emit NadfunBuyExecuted(decoded.router, decoded.token, amountIn, amountOut, vault);
    }

    function _decode(bytes calldata data) internal pure returns (NadfunExecutionDataV1 memory decoded) {
        (
            uint8 version,
            uint8 action,
            uint8 venue,
            address router,
            address recipient,
            address token,
            uint64 deadline,
            uint256 amountOutMin,
            bytes memory extra
        ) = abi.decode(data, (uint8, uint8, uint8, address, address, address, uint64, uint256, bytes));

        decoded = NadfunExecutionDataV1({
            version: version,
            action: action,
            venue: venue,
            router: router,
            recipient: recipient,
            token: token,
            deadline: deadline,
            amountOutMin: amountOutMin,
            extra: extra
        });
    }
}
