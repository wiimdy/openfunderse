// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IExecutionAdapter} from "../interfaces/IExecutionAdapter.sol";
import {IExecutionAdapterQuote} from "../interfaces/IExecutionAdapterQuote.sol";
import {INadFunLens} from "../interfaces/INadFunLens.sol";
import {INadFunRouter} from "../interfaces/INadFunRouter.sol";

interface IWMon {
    function withdraw(uint256 amount) external;
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title NadfunExecutionAdapter
/// @notice Real execution adapter for NadFun router buy path using WMON->MON unwrap.
contract NadfunExecutionAdapter is Initializable, OwnableUpgradeable, UUPSUpgradeable, IExecutionAdapter, IExecutionAdapterQuote {
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

    address public wmon;
    address public bondingCurveRouter;
    address public dexRouter;
    bool public upgradesFrozen;
    mapping(address => bool) public authorizedCallers;

    event NadfunBuyExecuted(address indexed router, address indexed token, uint256 amountIn, uint256 amountOut, address indexed recipient);
    event UpgradesFrozen();
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);

    error UnsupportedAction();
    error InvalidExecutionData();
    error DeadlineExpired();
    error InvalidTokenIn();
    error UnsupportedRouter();
    error WrapFailed();
    error UpgradesAreFrozen();

    bytes32 private constant QUOTE_OK = "OK";
    bytes32 private constant QUOTE_INVALID_DATA = "INVALID_DATA";
    bytes32 private constant QUOTE_EXPIRED = "EXPIRED";
    bytes32 private constant QUOTE_INVALID_TOKEN_IN = "INVALID_TOKEN_IN";
    bytes32 private constant QUOTE_UNSUPPORTED_ROUTER = "UNSUPPORTED_ROUTER";
    bytes32 private constant QUOTE_ROUTER_MISMATCH = "ROUTER_MISMATCH";
    bytes32 private constant QUOTE_AMOUNT_OUT_MIN_NOT_MET = "AMOUNT_OUT_MIN_NOT_MET";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address wmon_, address bondingCurveRouter_, address dexRouter_) external initializer {
        if (wmon_ == address(0) || bondingCurveRouter_ == address(0) || dexRouter_ == address(0)) {
            revert InvalidExecutionData();
        }

        __Ownable_init(owner_);

        wmon = wmon_;
        bondingCurveRouter = bondingCurveRouter_;
        dexRouter = dexRouter_;
    }

    function freezeUpgrades() external onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
        upgradesFrozen = true;
        emit UpgradesFrozen();
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert InvalidExecutionData();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    receive() external payable {}

    function execute(address vault, address tokenIn, address tokenOut, uint256 amountIn, bytes calldata data)
        external
        returns (uint256 amountOut)
    {
        require(authorizedCallers[msg.sender], "unauthorized caller");
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

    function quote(address lens, address tokenIn, address tokenOut, uint256 amountIn, bytes calldata data)
        external
        view
        returns (bool ok, uint256 expectedAmountOut, bytes32 reasonCode)
    {
        NadfunExecutionDataV1 memory decoded = _decode(data);
        if (decoded.version != 1) {
            return (false, 0, QUOTE_INVALID_DATA);
        }
        if (decoded.deadline < block.timestamp) {
            return (false, 0, QUOTE_EXPIRED);
        }
        if (decoded.router != bondingCurveRouter && decoded.router != dexRouter) {
            return (false, 0, QUOTE_UNSUPPORTED_ROUTER);
        }

        if (decoded.action == 1) {
            if (tokenIn != wmon) return (false, 0, QUOTE_INVALID_TOKEN_IN);
            if (decoded.token != tokenOut) return (false, 0, QUOTE_INVALID_DATA);

            (address router, uint256 amountOut) = INadFunLens(lens).getAmountOut(tokenOut, amountIn, true);
            if (router != decoded.router) return (false, amountOut, QUOTE_ROUTER_MISMATCH);
            if (amountOut < decoded.amountOutMin) return (false, amountOut, QUOTE_AMOUNT_OUT_MIN_NOT_MET);

            return (true, amountOut, QUOTE_OK);
        }

        if (decoded.action == 2) {
            if (tokenOut != wmon) return (false, 0, QUOTE_INVALID_TOKEN_IN);
            if (decoded.token != tokenIn) return (false, 0, QUOTE_INVALID_DATA);

            (address router, uint256 amountOut) = INadFunLens(lens).getAmountOut(tokenIn, amountIn, false);
            if (router != decoded.router) return (false, amountOut, QUOTE_ROUTER_MISMATCH);
            if (amountOut < decoded.amountOutMin) return (false, amountOut, QUOTE_AMOUNT_OUT_MIN_NOT_MET);

            return (true, amountOut, QUOTE_OK);
        }

        return (false, 0, QUOTE_INVALID_DATA);
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

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
    }

    uint256[50] private __gap;
}
