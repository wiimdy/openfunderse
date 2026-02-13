// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {IntentBook, ISnapshotBook} from "../src/IntentBook.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract MockSnapshotBookForGovernance is ISnapshotBook {
    function isSnapshotFinalized(bytes32) external pure returns (bool) {
        return true;
    }
}

contract GovernanceHardeningTest is Test {
    address internal owner = makeAddr("owner");
    address internal outsider = makeAddr("outsider");

    MockSnapshotBookForGovernance internal snapshots;
    IntentBook internal book;
    ClawVault4626 internal vault;
    ClawCore internal core;
    NadfunExecutionAdapter internal adapter;

    function setUp() external {
        snapshots = new MockSnapshotBookForGovernance();

        book = _deployIntentBook(owner, makeAddr("strategy"), address(snapshots), 1);
        vault = _deployVault(owner, makeAddr("asset"), "Vault", "VLT");
        core = _deployCore(owner, address(book), address(vault));
        adapter = _deployAdapter(owner, makeAddr("wmon"), makeAddr("bonding"), makeAddr("dex"));
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

    function _deployAdapter(address owner_, address wmon_, address bonding_, address dex_)
        internal
        returns (NadfunExecutionAdapter deployed)
    {
        NadfunExecutionAdapter impl = new NadfunExecutionAdapter();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl), abi.encodeCall(NadfunExecutionAdapter.initialize, (owner_, wmon_, bonding_, dex_))
        );
        deployed = NadfunExecutionAdapter(payable(address(proxy)));
    }

    function testFreezeConfigBlocksCoreMutations() external {
        vm.prank(owner);
        core.freezeConfig();

        vm.prank(owner);
        vm.expectRevert(ClawCore.ConfigIsFrozen.selector);
        core.setNadfunLens(makeAddr("new-lens"));
    }

    function testFreezeConfigBlocksVaultMutations() external {
        vm.prank(owner);
        vault.freezeConfig();

        vm.prank(owner);
        vm.expectRevert(ClawVault4626.ConfigIsFrozen.selector);
        vault.setTokenAllowed(makeAddr("token"), true);
    }

    function testFreezeConfigBlocksIntentBookMutations() external {
        vm.prank(owner);
        book.freezeConfig();

        vm.prank(owner);
        vm.expectRevert(IntentBook.ConfigIsFrozen.selector);
        book.setDefaultThresholdWeight(2);
    }

    function testFreezeUpgradesBlocksCoreUpgrade() external {
        ClawCore newImpl = new ClawCore();

        vm.prank(owner);
        core.freezeUpgrades();

        vm.prank(owner);
        vm.expectRevert(ClawCore.UpgradesAreFrozen.selector);
        core.upgradeToAndCall(address(newImpl), bytes(""));
    }

    function testFreezeUpgradesBlocksVaultUpgrade() external {
        ClawVault4626 newImpl = new ClawVault4626();

        vm.prank(owner);
        vault.freezeUpgrades();

        vm.prank(owner);
        vm.expectRevert(ClawVault4626.UpgradesAreFrozen.selector);
        vault.upgradeToAndCall(address(newImpl), bytes(""));
    }

    function testFreezeUpgradesBlocksIntentBookUpgrade() external {
        IntentBook newImpl = new IntentBook();

        vm.prank(owner);
        book.freezeUpgrades();

        vm.prank(owner);
        vm.expectRevert(IntentBook.UpgradesAreFrozen.selector);
        book.upgradeToAndCall(address(newImpl), bytes(""));
    }

    function testFreezeUpgradesBlocksNadfunAdapterUpgrade() external {
        NadfunExecutionAdapter newImpl = new NadfunExecutionAdapter();

        vm.prank(owner);
        adapter.freezeUpgrades();

        vm.prank(owner);
        vm.expectRevert(NadfunExecutionAdapter.UpgradesAreFrozen.selector);
        adapter.upgradeToAndCall(address(newImpl), bytes(""));
    }

    function testOnlyOwnerCanFreeze() external {
        vm.prank(outsider);
        vm.expectRevert();
        core.freezeConfig();

        vm.prank(outsider);
        vm.expectRevert();
        core.freezeUpgrades();
    }
}
