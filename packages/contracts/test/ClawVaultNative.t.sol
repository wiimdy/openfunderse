// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {IExecutionAdapter} from "../src/interfaces/IExecutionAdapter.sol";

contract MockWMON {
    string public name = "Wrapped MON";
    string public symbol = "WMON";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {}

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw transfer failed");
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockERC20ForVault {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPnlAdapter is IExecutionAdapter {
    uint256 public nextAmountOut;

    function setNextAmountOut(uint256 amountOut) external {
        nextAmountOut = amountOut;
    }

    function execute(address vault, address, address tokenOut, uint256, bytes calldata)
        external
        returns (uint256 amountOut)
    {
        amountOut = nextAmountOut;
        if (tokenOut.code.length > 0) {
            // Works for both MockWMON and MockERC20ForVault
            (bool ok,) = tokenOut.call(abi.encodeWithSignature("mint(address,uint256)", vault, amountOut));
            require(ok, "mint failed");
        }
    }
}

contract ClawVaultNativeTest is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal gasWallet = makeAddr("gasWallet");

    MockWMON internal wmon;
    MockERC20ForVault internal meme;
    MockERC20ForVault internal alt;
    MockPnlAdapter internal adapter;
    ClawVault4626 internal vault;

    function setUp() external {
        wmon = new MockWMON();
        meme = new MockERC20ForVault("Meme", "MEME", 18);
        alt = new MockERC20ForVault("Alt", "ALT", 18);
        adapter = new MockPnlAdapter();

        vault = _deployVault(owner, address(wmon), "Claw Vault", "CLAW");

        vm.startPrank(owner);
        vault.setCore(address(this));
        vault.setTokenAllowed(address(meme), true);
        vault.setTokenAllowed(address(alt), true);
        vault.setAdapterAllowed(address(adapter), true);
        vault.setPerformanceFeeRecipient(feeRecipient);
        vault.setPerformanceFeeBps(1000); // 10%
        vm.stopPrank();

        vm.deal(alice, 10 ether);
    }

    function _deployVault(address owner_, address asset_, string memory name_, string memory symbol_)
        internal
        returns (ClawVault4626 deployed)
    {
        ClawVault4626 impl = new ClawVault4626();
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(ClawVault4626.initialize, (owner_, asset_, name_, symbol_)));
        deployed = ClawVault4626(payable(address(proxy)));
    }

    function testDepositAndWithdrawNativeRoundTrip() external {
        vm.prank(alice);
        uint256 shares = vault.depositNative{value: 1 ether}(alice);
        assertEq(shares, 1 ether);
        assertEq(vault.balanceOf(alice), 1 ether);

        uint256 beforeNative = alice.balance;
        vm.prank(alice);
        uint256 burnedShares = vault.withdrawNative(0.4 ether, alice, alice);

        assertEq(burnedShares, 0.4 ether);
        assertEq(alice.balance, beforeNative + 0.4 ether);
        assertEq(vault.balanceOf(alice), 0.6 ether);
    }

    function testUnifiedDepositAutoRoutesNative() external {
        vm.prank(alice);
        uint256 shares = vault.deposit{value: 1 ether}(0, alice);
        assertEq(shares, 1 ether);
        assertEq(vault.balanceOf(alice), 1 ether);
    }

    function testUnifiedDepositRevertsOnNativeAmountMismatch() external {
        vm.prank(alice);
        vm.expectRevert(ClawVault4626.InvalidAmount.selector);
        vault.deposit{value: 1 ether}(0.5 ether, alice);
    }

    function testFundAndUserPerformanceViews() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        // Simulate strategy profit in asset token.
        wmon.mint(address(vault), 0.2 ether);

        (
            uint256 assets,
            uint256 principal,
            int256 pnl,
            uint256 realizedProfit,
            uint256 realizedLoss,
            ,
        ) = vault.fundPerformance();

        assertEq(assets, 1.2 ether);
        assertEq(principal, 1 ether);
        assertEq(pnl, int256(0.2 ether));
        assertEq(realizedProfit, 0);
        assertEq(realizedLoss, 0);

        (, uint256 assetValue, uint256 userPrincipal, int256 userPnl,) = vault.userPerformance(alice);
        assertEq(assetValue, 1.2 ether);
        assertEq(userPrincipal, 1 ether);
        assertEq(userPnl, int256(0.2 ether));
    }

    function testDepositNativeAppliesGasFeeBps() external {
        vm.prank(owner);
        vault.setGasFeeConfig(20, 0, gasWallet); // 0.20%
        vm.prank(owner);
        vault.setGasReserveTarget(type(uint256).max);

        vm.prank(alice);
        uint256 shares = vault.depositNative{value: 10 ether}(alice);

        uint256 expectedFee = 0.02 ether;
        uint256 expectedNet = 10 ether - expectedFee;

        assertEq(shares, expectedNet);
        assertEq(vault.balanceOf(alice), expectedNet);
        assertEq(vault.gasReserve(), expectedFee);
        assertEq(wmon.balanceOf(address(vault)), 10 ether);
    }

    function testDepositNativeAppliesGasFeeCap() external {
        vm.prank(owner);
        vault.setGasFeeConfig(200, 0.05 ether, gasWallet); // 2% with 0.05 WMON cap
        vm.prank(owner);
        vault.setGasReserveTarget(type(uint256).max);

        vm.prank(alice);
        uint256 shares = vault.depositNative{value: 10 ether}(alice);

        uint256 expectedFee = 0.05 ether; // capped from 0.2 ether
        uint256 expectedNet = 10 ether - expectedFee;

        assertEq(shares, expectedNet);
        assertEq(vault.balanceOf(alice), expectedNet);
        assertEq(vault.gasReserve(), expectedFee);
        assertEq(wmon.balanceOf(address(vault)), 10 ether);
    }

    function testRealizedProfitMintsPerformanceFeeShares() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        // BUY: asset -> meme
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");

        // SELL: meme -> asset, profitable versus tracked 0.5 ether cost basis
        adapter.setNextAmountOut(0.8 ether);
        vault.executeTrade(bytes32("sell"), address(meme), address(wmon), 100e18, 1, address(adapter), "");

        (, uint256 principal, int256 pnl, uint256 realizedProfit,,,) = vault.fundPerformance();

        assertEq(principal, 1 ether);
        assertTrue(pnl > 0);
        assertEq(realizedProfit, 0.3 ether);
        assertTrue(vault.balanceOf(feeRecipient) > 0);
    }

    function testWithdrawBlockedWhileOpenPositionsExist() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");

        assertTrue(vault.hasOpenPositions());

        // Deposit is allowed during open positions.
        vm.prank(alice);
        uint256 shares = vault.depositNative{value: 0.1 ether}(alice);
        assertGt(shares, 0);

        // Withdraw is still blocked.
        vm.expectRevert(ClawVault4626.ShareOpsBlockedWithOpenPositions.selector);
        vm.prank(alice);
        vault.withdraw(0.1 ether, alice, alice);

        adapter.setNextAmountOut(0.5 ether);
        vault.executeTrade(bytes32("sell"), address(meme), address(wmon), 100e18, 1, address(adapter), "");

        assertFalse(vault.hasOpenPositions());

        vm.prank(alice);
        vault.withdraw(0.1 ether, alice, alice);
    }

    function testUntrackedSellPortionDoesNotMintPerformanceFee() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        // Track one buy lot (100 MEME at 0.5 WMON cost basis)
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");

        // Extra MEME arrives without tracked cost basis.
        meme.mint(address(vault), 100e18);

        // Sell total 200 MEME for 1.0 WMON. Only 100 tracked qty should participate in PnL accounting.
        adapter.setNextAmountOut(1 ether);
        vault.executeTrade(bytes32("sell"), address(meme), address(wmon), 200e18, 1, address(adapter), "");

        (, , , uint256 realizedProfit, uint256 realizedLoss, ,) = vault.fundPerformance();
        assertEq(realizedProfit, 0);
        assertEq(realizedLoss, 0);
        assertEq(vault.balanceOf(feeRecipient), 0);
    }

    function testExecuteTradeRevertsForNonAssetToNonAssetPath() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");

        adapter.setNextAmountOut(100e18);
        vm.expectRevert(ClawVault4626.UnsupportedTradePath.selector);
        vault.executeTrade(bytes32("swap"), address(meme), address(alt), 50e18, 1, address(adapter), "");
    }

    function testPerformanceFeeSettlementWaitsUntilAllPositionsClosed() external {
        vm.prank(alice);
        vault.depositNative{value: 2 ether}(alice);

        // Open position #1 (MEME)
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy-meme"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        // Open position #2 (ALT)
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy-alt"), address(wmon), address(alt), 0.5 ether, 1, address(adapter), "");

        // Close MEME with profit while ALT is still open -> fee should remain pending.
        adapter.setNextAmountOut(0.8 ether);
        vault.executeTrade(bytes32("sell-meme"), address(meme), address(wmon), 100e18, 1, address(adapter), "");

        assertEq(vault.pendingPerformanceFeeAssets(), 0.03 ether);
        assertEq(vault.balanceOf(feeRecipient), 0);
        assertTrue(vault.hasOpenPositions());

        // Close ALT at cost basis -> triggers pending fee settlement.
        adapter.setNextAmountOut(0.5 ether);
        vault.executeTrade(bytes32("sell-alt"), address(alt), address(wmon), 100e18, 1, address(adapter), "");

        assertEq(vault.pendingPerformanceFeeAssets(), 0);
        assertFalse(vault.hasOpenPositions());
        assertTrue(vault.balanceOf(feeRecipient) > 0);
    }

    function testMaxViewsReflectOpenPositionGate() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        assertEq(vault.maxRedeem(alice), vault.balanceOf(alice));
        assertEq(vault.maxWithdraw(alice), vault.convertToAssets(vault.balanceOf(alice)));
        assertGt(vault.maxDeposit(alice), 0);
        assertGt(vault.maxMint(alice), 0);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");

        // Deposit/mint views remain open during positions.
        assertGt(vault.maxDeposit(alice), 0);
        assertGt(vault.maxMint(alice), 0);
        // Withdraw/redeem views are blocked during positions.
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
    }

    function testQueueDepositSettlesWhenFlat() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        wmon.mint(alice, 0.2 ether);
        vm.prank(alice);
        wmon.approve(address(vault), 0.2 ether);

        vm.prank(alice);
        uint256 requestId = vault.queueDeposit(0.2 ether, alice);

        (address queuedOwner,, uint256 queuedAssets,, uint8 statusBefore) = vault.pendingDeposits(requestId);
        assertEq(queuedOwner, alice);
        assertEq(queuedAssets, 0.2 ether);
        assertEq(statusBefore, vault.DEPOSIT_REQUEST_PENDING());

        uint256 beforeShares = vault.balanceOf(alice);
        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;
        vault.settleQueuedDeposits(ids);

        assertGt(vault.balanceOf(alice), beforeShares);
        (,,, , uint8 statusAfter) = vault.pendingDeposits(requestId);
        assertEq(statusAfter, vault.DEPOSIT_REQUEST_SETTLED());
    }

    function testQueueDepositSettleAlsoAppliesGasFee() external {
        vm.prank(owner);
        vault.setGasFeeConfig(1000, 0, gasWallet); // 10%
        vm.prank(owner);
        vault.setGasReserveTarget(type(uint256).max);

        wmon.mint(alice, 1 ether);
        vm.prank(alice);
        wmon.approve(address(vault), 1 ether);

        vm.prank(alice);
        uint256 requestId = vault.queueDeposit(1 ether, alice);

        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;
        vault.settleQueuedDeposits(ids);

        assertEq(vault.balanceOf(alice), 0.9 ether);
        assertEq(vault.gasReserve(), 0.1 ether);
        assertEq(wmon.balanceOf(address(vault)), 1 ether);
    }

    function testGasReserveStopsSkimAfterTargetReached() external {
        vm.prank(owner);
        vault.setGasFeeConfig(1000, 0, gasWallet); // 10%
        vm.prank(owner);
        vault.setGasReserveTarget(0.05 ether);

        vm.prank(alice);
        uint256 sharesFirst = vault.depositNative{value: 1 ether}(alice);
        assertEq(sharesFirst, 0.95 ether);
        assertEq(vault.gasReserve(), 0.05 ether);

        vm.prank(alice);
        uint256 sharesSecond = vault.depositNative{value: 1 ether}(alice);
        assertEq(sharesSecond, 1 ether);
        assertEq(vault.gasReserve(), 0.05 ether);
    }

    function testTopUpStrategyGasSpendsReserveAndSendsNative() external {
        vm.prank(owner);
        vault.setGasFeeConfig(1000, 0, gasWallet); // 10%
        vm.prank(owner);
        vault.setGasReserveTarget(1 ether);

        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice); // reserve += 0.1 ether

        uint256 beforeNative = gasWallet.balance;
        vm.prank(owner);
        vault.topUpStrategyGas(0.06 ether);

        assertEq(vault.gasReserve(), 0.04 ether);
        assertEq(gasWallet.balance, beforeNative + 0.06 ether);
    }

    function testSettleQueuedDepositsAllowedDuringOpenPositions() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        wmon.mint(alice, 0.2 ether);
        vm.prank(alice);
        wmon.approve(address(vault), 0.2 ether);
        vm.prank(alice);
        uint256 requestId = vault.queueDeposit(0.2 ether, alice);

        uint256 beforeShares = vault.balanceOf(alice);
        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;
        vault.settleQueuedDeposits(ids);

        assertGt(vault.balanceOf(alice), beforeShares);
        (,,,,uint8 status) = vault.pendingDeposits(requestId);
        assertEq(status, vault.DEPOSIT_REQUEST_SETTLED());
    }

    // ── Deposit-during-open-positions tests (issue #76) ─────────────────

    function testDepositERC20AllowedDuringOpenPositions() external {
        // Seed vault with initial deposit.
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        // Open a meme position.
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        // New participant deposits ERC20 while position is open.
        address bob = makeAddr("bob");
        wmon.mint(bob, 0.5 ether);
        vm.prank(bob);
        wmon.approve(address(vault), 0.5 ether);
        vm.prank(bob);
        uint256 shares = vault.deposit(0.5 ether, bob);

        assertGt(shares, 0);
        assertEq(vault.balanceOf(bob), shares);
    }

    function testDepositNativeAllowedDuringOpenPositions() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        // New participant deposits native while position is open.
        address bob = makeAddr("bob");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        uint256 shares = vault.depositNative{value: 0.5 ether}(bob);

        assertGt(shares, 0);
        assertEq(vault.balanceOf(bob), shares);
    }

    function testSharePriceBasedOnBaseAssetDuringOpenPositions() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        uint256 priceBefore = vault.sharePriceX18();

        // Buy meme: 0.5 WMON leaves vault.
        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        uint256 priceDuring = vault.sharePriceX18();
        // Price drops because totalAssets only counts WMON balance.
        assertLt(priceDuring, priceBefore);

        // New depositor gets shares at this lower price → more shares per asset.
        address bob = makeAddr("bob");
        vm.deal(bob, 0.5 ether);
        vm.prank(bob);
        uint256 bobShares = vault.depositNative{value: 0.5 ether}(bob);
        // Bob gets exactly 0.5 ether worth at current NAV (0.5 WMON in vault, 1 share outstanding).
        // sharePrice = 0.5e18/1e18 = 0.5e18 per share → 0.5e18 deposit / 0.5e18 price = 1e18 shares.
        assertEq(bobShares, 1 ether);

        // Close position profitably.
        adapter.setNextAmountOut(0.8 ether);
        vault.executeTrade(bytes32("sell"), address(meme), address(wmon), 100e18, 1, address(adapter), "");
        assertFalse(vault.hasOpenPositions());

        // Both alice and bob benefit from the price recovery.
        uint256 priceAfter = vault.sharePriceX18();
        assertGt(priceAfter, priceDuring);
    }

    function testWithdrawNativeStillBlockedDuringOpenPositions() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        vm.expectRevert(ClawVault4626.ShareOpsBlockedWithOpenPositions.selector);
        vm.prank(alice);
        vault.withdrawNative(0.1 ether, alice, alice);

        vm.expectRevert(ClawVault4626.ShareOpsBlockedWithOpenPositions.selector);
        vm.prank(alice);
        vault.redeem(0.1 ether, alice, alice);
    }

    function testMultipleDepositsDuringOpenPositionsAccounting() external {
        vm.prank(alice);
        vault.depositNative{value: 1 ether}(alice);

        adapter.setNextAmountOut(100e18);
        vault.executeTrade(bytes32("buy"), address(wmon), address(meme), 0.5 ether, 1, address(adapter), "");
        assertTrue(vault.hasOpenPositions());

        // Two deposits while position is open.
        address bob = makeAddr("bob");
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        vault.depositNative{value: 0.3 ether}(bob);
        vm.prank(bob);
        vault.depositNative{value: 0.2 ether}(bob);

        // Principal tracking is correct.
        assertEq(vault.netDepositedAssets(bob), 0.5 ether);
        assertGt(vault.balanceOf(bob), 0);
        // Total supply increased.
        assertGt(vault.totalSupply(), 1 ether);
    }

    function testCancelQueuedDeposit() external {
        wmon.mint(alice, 0.2 ether);
        vm.prank(alice);
        wmon.approve(address(vault), 0.2 ether);
        vm.prank(alice);
        uint256 requestId = vault.queueDeposit(0.2 ether, alice);

        vm.expectRevert(ClawVault4626.NotDepositRequestOwner.selector);
        vm.prank(owner);
        vault.cancelQueuedDeposit(requestId);

        vm.prank(alice);
        vault.cancelQueuedDeposit(requestId);

        (,,, , uint8 statusAfterCancel) = vault.pendingDeposits(requestId);
        assertEq(statusAfterCancel, vault.DEPOSIT_REQUEST_CANCELLED());

        uint256[] memory ids = new uint256[](1);
        ids[0] = requestId;
        vault.settleQueuedDeposits(ids);

        (,,, , uint8 statusAfterSettle) = vault.pendingDeposits(requestId);
        assertEq(statusAfterSettle, vault.DEPOSIT_REQUEST_CANCELLED());
    }
}
