// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract HardenFundGovernance is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address timelock = vm.envAddress("GOVERNANCE_TIMELOCK");

        address core = vm.envOr("CORE_ADDRESS", address(0));
        address vault = vm.envOr("VAULT_ADDRESS", address(0));
        address intentBook = vm.envOr("INTENT_BOOK_ADDRESS", address(0));
        address adapter = vm.envOr("ADAPTER_ADDRESS", address(0));

        bool freezeConfig = vm.envOr("FREEZE_CONFIG", true);
        bool freezeUpgrades = vm.envOr("FREEZE_UPGRADES", false);

        vm.startBroadcast(deployerPk);

        if (core != address(0)) {
            ClawCore coreContract = ClawCore(core);
            if (freezeConfig && !coreContract.configFrozen()) {
                coreContract.freezeConfig();
            }
            if (freezeUpgrades && !coreContract.upgradesFrozen()) {
                coreContract.freezeUpgrades();
            }
            if (coreContract.owner() != timelock) {
                coreContract.transferOwnership(timelock);
            }
            console2.log("HARDENED_CORE", core);
        }

        if (vault != address(0)) {
            ClawVault4626 vaultContract = ClawVault4626(payable(vault));
            if (freezeConfig && !vaultContract.configFrozen()) {
                vaultContract.freezeConfig();
            }
            if (freezeUpgrades && !vaultContract.upgradesFrozen()) {
                vaultContract.freezeUpgrades();
            }
            if (vaultContract.owner() != timelock) {
                vaultContract.transferOwnership(timelock);
            }
            console2.log("HARDENED_VAULT", vault);
        }

        if (intentBook != address(0)) {
            IntentBook intentContract = IntentBook(intentBook);
            if (freezeConfig && !intentContract.configFrozen()) {
                intentContract.freezeConfig();
            }
            if (freezeUpgrades && !intentContract.upgradesFrozen()) {
                intentContract.freezeUpgrades();
            }
            if (intentContract.owner() != timelock) {
                intentContract.transferOwnership(timelock);
            }
            console2.log("HARDENED_INTENT_BOOK", intentBook);
        }

        if (adapter != address(0)) {
            NadfunExecutionAdapter adapterContract = NadfunExecutionAdapter(payable(adapter));
            if (freezeUpgrades && !adapterContract.upgradesFrozen()) {
                adapterContract.freezeUpgrades();
            }
            if (adapterContract.owner() != timelock) {
                adapterContract.transferOwnership(timelock);
            }
            console2.log("HARDENED_ADAPTER", adapter);
        }

        vm.stopBroadcast();

        console2.log("GOVERNANCE_TIMELOCK", timelock);
        console2.log("FREEZE_CONFIG", freezeConfig);
        console2.log("FREEZE_UPGRADES", freezeUpgrades);
    }
}
