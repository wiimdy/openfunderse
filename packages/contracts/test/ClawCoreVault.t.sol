// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IntentBook, ISnapshotBook} from "../src/IntentBook.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {IExecutionAdapter} from "../src/interfaces/IExecutionAdapter.sol";
import {IExecutionAdapterQuote} from "../src/interfaces/IExecutionAdapterQuote.sol";

contract MockSnapshotBookForCore is ISnapshotBook {
    mapping(bytes32 => bool) public finalized;

    function setFinalized(bytes32 snapshotHash, bool isFinalized) external {
        finalized[snapshotHash] = isFinalized;
    }

    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool) {
        return finalized[snapshotHash];
    }
}

contract MockERC20 {
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
        _transfer(msg.sender, to, amount);
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
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockExecutionAdapter is IExecutionAdapter, IExecutionAdapterQuote {
    uint256 public nextAmountOut;
    bool public quoteOk = true;
    bytes32 public quoteReasonCode = "OK";

    function setNextAmountOut(uint256 amountOut) external {
        nextAmountOut = amountOut;
    }

    function execute(address vault, address, address tokenOut, uint256, bytes calldata)
        external
        returns (uint256 amountOut)
    {
        amountOut = nextAmountOut;
        MockERC20(tokenOut).mint(vault, amountOut);
    }

    function setQuote(bool ok, bytes32 reasonCode) external {
        quoteOk = ok;
        quoteReasonCode = reasonCode;
    }

    function quote(address, address, address, uint256, bytes calldata)
        external
        view
        returns (bool ok, uint256 expectedAmountOut, bytes32 reasonCode)
    {
        return (quoteOk, nextAmountOut, quoteReasonCode);
    }
}

contract ClawCoreVaultTest is Test {
    uint256 internal constant PK_STRATEGY = 0xA11CE;
    uint256 internal constant PK_VERIFIER = 0xB0B;

    address internal owner = makeAddr("owner");
    address internal strategy = vm.addr(PK_STRATEGY);
    address internal verifier = vm.addr(PK_VERIFIER);
    address internal depositor = makeAddr("depositor");

    MockSnapshotBookForCore internal snapshots;
    IntentBook internal book;
    ClawVault4626 internal vault;
    ClawCore internal core;
    MockERC20 internal usdc;
    MockERC20 internal meme;
    MockExecutionAdapter internal adapter;

    bytes32 internal snapshotHash = keccak256("snapshot-core-1");
    bytes32 internal intentHash = keccak256("intent-core-1");

    function setUp() external {
        snapshots = new MockSnapshotBookForCore();
        snapshots.setFinalized(snapshotHash, true);

        book = _deployIntentBook(owner, strategy, address(snapshots), 3);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        meme = new MockERC20("Meme", "MEME", 18);
        adapter = new MockExecutionAdapter();

        vault = _deployVault(owner, address(usdc), "Claw Vault", "CLAW");
        core = _deployCore(owner, address(book), address(vault));

        vm.startPrank(owner);
        book.setVerifier(verifier, true, 3);
        vault.setCore(address(core));
        vault.setTokenAllowed(address(meme), true);
        vault.setAdapterAllowed(address(adapter), true);
        core.setNadfunLens(makeAddr("nadfun-lens"));
        vm.stopPrank();

        usdc.mint(depositor, 1_000_000_000);
        vm.prank(depositor);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(depositor);
        vault.deposit(500_000_000, depositor);

        adapter.setNextAmountOut(2_000e18);
    }

    function _deployIntentBook(address owner_, address strategy_, address snapshotBook_, uint256 threshold)
        internal
        returns (IntentBook deployed)
    {
        IntentBook impl = new IntentBook();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl), abi.encodeCall(IntentBook.initialize, (owner_, strategy_, snapshotBook_, threshold))
        );
        deployed = IntentBook(address(proxy));
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

    function _deployCore(address owner_, address intentBook_, address vault_) internal returns (ClawCore deployed) {
        ClawCore impl = new ClawCore();
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(ClawCore.initialize, (owner_, intentBook_, vault_)));
        deployed = ClawCore(address(proxy));
    }

    function testExecuteIntentRevertsBeforeApproval() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 300, 1_000_000_000, _allowlistHash(1000e18, 970e18));
        ClawCore.ExecutionRequest memory req = _req(1000e18, 970e18);

        vm.expectRevert(ClawCore.IntentNotApproved.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentRevertsWhenExpired() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1), 300, 1_000_000_000, _allowlistHash(1000e18, 970e18));
        _approveIntent(intentHash, 1);

        vm.warp(block.timestamp + 2);
        ClawCore.ExecutionRequest memory req = _req(1000e18, 970e18);

        vm.expectRevert(ClawCore.IntentExpired.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentRevertsOnAllowlistViolation() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 300, 1_000_000_000, _allowlistHash(1000e18, 970e18));
        _approveIntent(intentHash, 1);

        ClawCore.ExecutionRequest memory req = ClawCore.ExecutionRequest({
            tokenIn: address(usdc),
            tokenOut: address(usdc),
            amountIn: 1_000_000,
            quoteAmountOut: 1000e18,
            minAmountOut: 970e18,
            adapter: address(adapter),
            adapterData: ""
        });

        vm.expectRevert(ClawCore.AllowlistViolation.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentRevertsOnSlippageViolation() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 900e18));
        _approveIntent(intentHash, 1);

        ClawCore.ExecutionRequest memory req = _req(1000e18, 900e18);

        vm.expectRevert(ClawCore.SlippageExceeded.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentRevertsWhenCorePaused() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));
        _approveIntent(intentHash, 1);

        vm.prank(owner);
        core.setPaused(true);

        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);
        vm.expectRevert(ClawCore.CorePaused.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentRevertsWhenVaultPaused() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));
        _approveIntent(intentHash, 1);

        vm.prank(owner);
        vault.setPaused(true);

        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);
        vm.expectRevert(ClawVault4626.VaultPaused.selector);
        core.executeIntent(intentHash, req);
    }

    function testExecuteIntentSuccess() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));
        _approveIntent(intentHash, 1);

        uint256 beforeMeme = meme.balanceOf(address(vault));
        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);

        uint256 out = core.executeIntent(intentHash, req);
        uint256 afterMeme = meme.balanceOf(address(vault));

        assertEq(out, 2_000e18);
        assertEq(afterMeme - beforeMeme, 2_000e18);
        assertTrue(core.executedIntent(intentHash));
    }

    function testDryRunIntentExecutionReturnsOkForExecutablePath() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));
        _approveIntent(intentHash, 1);

        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);
        ClawCore.DryRunResult memory r = core.dryRunIntentExecution(intentHash, req);

        assertEq(r.failureCode, bytes32("OK"));
        assertTrue(r.quoteOk);
        assertEq(r.expectedAmountOut, 2_000e18);
    }

    function testDryRunIntentExecutionReturnsQuoteBelowMin() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));
        _approveIntent(intentHash, 1);
        adapter.setNextAmountOut(800e18);

        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);
        ClawCore.DryRunResult memory r = core.dryRunIntentExecution(intentHash, req);

        assertEq(r.failureCode, bytes32("QUOTE_BELOW_MIN"));
        assertEq(r.expectedAmountOut, 800e18);
    }

    function testDryRunIntentExecutionReturnsIntentNotApproved() external {
        _proposeIntent(intentHash, uint64(block.timestamp + 1 hours), 500, 1_000_000_000, _allowlistHash(1000e18, 960e18));

        ClawCore.ExecutionRequest memory req = _req(1000e18, 960e18);
        ClawCore.DryRunResult memory r = core.dryRunIntentExecution(intentHash, req);

        assertEq(r.failureCode, bytes32("INTENT_NOT_APPROVED"));
        assertEq(r.quoteReasonCode, bytes32("QUOTE_SKIPPED"));
    }

    function _proposeIntent(
        bytes32 _intentHash,
        uint64 deadline,
        uint16 maxSlippageBps,
        uint256 maxNotional,
        bytes32 allowlistHash
    ) internal {
        IntentBook.Constraints memory c = IntentBook.Constraints({
            allowlistHash: allowlistHash,
            maxSlippageBps: maxSlippageBps,
            maxNotional: maxNotional,
            deadline: deadline
        });

        vm.prank(strategy);
        book.proposeIntent(_intentHash, "ipfs://intent-core", snapshotHash, c);
    }

    function _approveIntent(bytes32 _intentHash, uint256 nonce) internal {
        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: nonce,
            signature: _sign(PK_VERIFIER, _digest(_intentHash, verifier, expiresAt, nonce))
        });

        book.attestIntent(_intentHash, verifiers, atts);
        assertTrue(book.isIntentApproved(_intentHash));
    }

    function _req(uint256 quoteAmountOut, uint256 minAmountOut)
        internal
        view
        returns (ClawCore.ExecutionRequest memory)
    {
        return ClawCore.ExecutionRequest({
            tokenIn: address(usdc),
            tokenOut: address(meme),
            amountIn: 1_000_000,
            quoteAmountOut: quoteAmountOut,
            minAmountOut: minAmountOut,
            adapter: address(adapter),
            adapterData: ""
        });
    }

    function _allowlistHash(uint256 quoteAmountOut, uint256 minAmountOut) internal view returns (bytes32) {
        return keccak256(
            abi.encode(address(usdc), address(meme), quoteAmountOut, minAmountOut, address(adapter), keccak256(bytes("")))
        );
    }

    function _digest(bytes32 _intentHash, address _verifier, uint64 expiresAt, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainTypehash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 attTypehash = keccak256(
            "IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)"
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                domainTypehash,
                keccak256(bytes("ClawIntentBook")),
                keccak256(bytes("1")),
                block.chainid,
                address(book)
            )
        );

        bytes32 structHash = keccak256(abi.encode(attTypehash, _intentHash, _verifier, expiresAt, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
