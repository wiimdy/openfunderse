// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {MockSnapshotBook} from "../src/mocks/MockSnapshotBook.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract DeployClawIntentStack is Script {
    struct Config {
        address owner;
        address verifier;
        address strategy;
        bytes32 snapshotHash;
        address wmon;
        address bondingRouter;
        address dexRouter;
        address lens;
        address targetTokenToAllow;
        uint256 thresholdWeight;
        uint256 verifierWeight;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 verifierPk = vm.envUint("VERIFIER_PRIVATE_KEY");
        Config memory c = _loadConfig(deployerPk, verifierPk);

        vm.startBroadcast(deployerPk);

        MockSnapshotBook snapshots = new MockSnapshotBook();
        snapshots.setFinalized(c.snapshotHash, true);

        ERC1967Proxy bookProxy = new ERC1967Proxy(
            address(new IntentBook()),
            abi.encodeCall(IntentBook.initialize, (c.owner, c.strategy, address(snapshots), c.thresholdWeight))
        );
        IntentBook book = IntentBook(address(bookProxy));
        book.setVerifier(c.verifier, true, c.verifierWeight);

        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(new ClawVault4626()),
            abi.encodeCall(ClawVault4626.initialize, (c.owner, c.wmon, "Claw Vault Share", "clSHARE"))
        );
        ClawVault4626 vault = ClawVault4626(payable(address(vaultProxy)));

        ERC1967Proxy coreProxy =
            new ERC1967Proxy(address(new ClawCore()), abi.encodeCall(ClawCore.initialize, (c.owner, address(book), address(vault))));
        ClawCore core = ClawCore(address(coreProxy));

        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(new NadfunExecutionAdapter()),
            abi.encodeCall(NadfunExecutionAdapter.initialize, (c.owner, c.wmon, c.bondingRouter, c.dexRouter))
        );
        NadfunExecutionAdapter adapter = NadfunExecutionAdapter(payable(address(adapterProxy)));

        vault.setCore(address(core));
        vault.setAdapterAllowed(address(adapter), true);
        vault.setTokenAllowed(c.targetTokenToAllow, true);
        if (c.lens != address(0)) {
            core.setNadfunLens(c.lens);
        }

        vm.stopBroadcast();

        console2.log("SNAPSHOT_BOOK", address(snapshots));
        console2.log("INTENT_BOOK", address(book));
        console2.log("VAULT", address(vault));
        console2.log("CORE", address(core));
        console2.log("ADAPTER", address(adapter));
        if (c.lens != address(0)) {
            console2.log("NADFUN_LENS", c.lens);
        }
        console2.log("SNAPSHOT_HASH");
        console2.logBytes32(c.snapshotHash);
    }

    function _loadConfig(uint256 deployerPk, uint256 verifierPk) internal view returns (Config memory c) {
        c.owner = vm.addr(deployerPk);
        c.verifier = vm.addr(verifierPk);
        c.strategy = vm.envOr("STRATEGY_ADDRESS", c.owner);
        c.snapshotHash = vm.envBytes32("SNAPSHOT_HASH");
        c.wmon = vm.envOr("NADFUN_WMON_ADDRESS", address(0xfB8BE43D65FbC1290d6178c6dba6E58c6d18fA60));
        c.bondingRouter = vm.envAddress("NADFUN_BONDING_CURVE_ROUTER");
        c.dexRouter = vm.envAddress("NADFUN_DEX_ROUTER");
        c.lens = vm.envOr("NADFUN_LENS_ADDRESS", address(0));
        c.targetTokenToAllow = vm.envAddress("NADFUN_TARGET_TOKEN");
        c.thresholdWeight = vm.envOr("INTENT_THRESHOLD_WEIGHT", uint256(1));
        c.verifierWeight = vm.envOr("VERIFIER_WEIGHT", uint256(1));
    }
}
