// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {MockSnapshotBook} from "../src/mocks/MockSnapshotBook.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract DeployClawIntentStack is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerPk);

        uint256 verifierPk = vm.envUint("VERIFIER_PRIVATE_KEY");
        address verifier = vm.addr(verifierPk);

        address strategy = vm.envOr("STRATEGY_ADDRESS", owner);
        bytes32 snapshotHash = vm.envBytes32("SNAPSHOT_HASH");

        address wmon = vm.envOr("NADFUN_WMON_ADDRESS", address(0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd));
        address bondingRouter = vm.envOr(
            "NADFUN_BONDING_CURVE_ROUTER", address(0x865054F0F6A288adaAc30261731361EA7E908003)
        );
        address dexRouter = vm.envOr("NADFUN_DEX_ROUTER", address(0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2));
        address targetTokenToAllow = vm.envAddress("NADFUN_TARGET_TOKEN");

        uint256 thresholdWeight = vm.envOr("INTENT_THRESHOLD_WEIGHT", uint256(1));
        uint256 verifierWeight = vm.envOr("VERIFIER_WEIGHT", uint256(1));

        vm.startBroadcast(deployerPk);

        MockSnapshotBook snapshots = new MockSnapshotBook();
        snapshots.setFinalized(snapshotHash, true);

        IntentBook book = new IntentBook(owner, strategy, address(snapshots), thresholdWeight);
        book.setVerifier(verifier, true, verifierWeight);

        ClawVault4626 vault = new ClawVault4626(owner, wmon, "Claw Vault Share", "clSHARE");
        ClawCore core = new ClawCore(owner, address(book), address(vault));
        NadfunExecutionAdapter adapter = new NadfunExecutionAdapter(wmon, bondingRouter, dexRouter);

        vault.setCore(address(core));
        vault.setAdapterAllowed(address(adapter), true);
        vault.setTokenAllowed(targetTokenToAllow, true);

        vm.stopBroadcast();

        console2.log("SNAPSHOT_BOOK", address(snapshots));
        console2.log("INTENT_BOOK", address(book));
        console2.log("VAULT", address(vault));
        console2.log("CORE", address(core));
        console2.log("ADAPTER", address(adapter));
        console2.log("SNAPSHOT_HASH");
        console2.logBytes32(snapshotHash);
    }
}
