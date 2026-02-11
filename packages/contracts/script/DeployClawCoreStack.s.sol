// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract DeployClawCoreStack is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);

        address intentBook = vm.envAddress("INTENT_BOOK_ADDRESS");
        address wmon = vm.envAddress("NADFUN_WMON_ADDRESS");
        address bondingRouter = vm.envAddress("NADFUN_BONDING_CURVE_ROUTER");
        address dexRouter = vm.envAddress("NADFUN_DEX_ROUTER");

        string memory vaultName = vm.envOr("CLAW_VAULT_NAME", string("Claw Vault Share"));
        string memory vaultSymbol = vm.envOr("CLAW_VAULT_SYMBOL", string("clSHARE"));
        address targetTokenToAllow = vm.envOr("TARGET_TOKEN_TO_ALLOW", address(0));

        vm.startBroadcast(pk);

        ClawVault4626 vault = new ClawVault4626(owner, wmon, vaultName, vaultSymbol);
        ClawCore core = new ClawCore(owner, intentBook, address(vault));
        NadfunExecutionAdapter adapter = new NadfunExecutionAdapter(wmon, bondingRouter, dexRouter);

        vault.setCore(address(core));
        vault.setAdapterAllowed(address(adapter), true);
        if (targetTokenToAllow != address(0)) {
            vault.setTokenAllowed(targetTokenToAllow, true);
        }

        vm.stopBroadcast();

        console2.log("DEPLOY_OWNER", owner);
        console2.log("INTENT_BOOK", intentBook);
        console2.log("VAULT", address(vault));
        console2.log("CORE", address(core));
        console2.log("ADAPTER", address(adapter));
        console2.log("WMON", wmon);
        console2.log("BONDING_ROUTER", bondingRouter);
        console2.log("DEX_ROUTER", dexRouter);
        if (targetTokenToAllow != address(0)) {
            console2.log("TARGET_TOKEN_ALLOWED", targetTokenToAllow);
        }
    }
}
