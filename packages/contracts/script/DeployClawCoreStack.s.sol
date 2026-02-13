// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {NadfunExecutionAdapter} from "../src/adapters/NadfunExecutionAdapter.sol";

contract DeployClawCoreStack is Script {
    struct Config {
        address owner;
        address intentBook;
        address wmon;
        address bondingRouter;
        address dexRouter;
        address lens;
        string vaultName;
        string vaultSymbol;
        address targetTokenToAllow;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Config memory c = _loadConfig(pk);

        vm.startBroadcast(pk);

        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(new ClawVault4626()),
            abi.encodeCall(ClawVault4626.initialize, (c.owner, c.wmon, c.vaultName, c.vaultSymbol))
        );
        ClawVault4626 vault = ClawVault4626(payable(address(vaultProxy)));

        ERC1967Proxy coreProxy =
            new ERC1967Proxy(address(new ClawCore()), abi.encodeCall(ClawCore.initialize, (c.owner, c.intentBook, address(vault))));
        ClawCore core = ClawCore(address(coreProxy));

        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(new NadfunExecutionAdapter()),
            abi.encodeCall(NadfunExecutionAdapter.initialize, (c.owner, c.wmon, c.bondingRouter, c.dexRouter))
        );
        NadfunExecutionAdapter adapter = NadfunExecutionAdapter(payable(address(adapterProxy)));

        vault.setCore(address(core));
        vault.setAdapterAllowed(address(adapter), true);
        if (c.targetTokenToAllow != address(0)) {
            vault.setTokenAllowed(c.targetTokenToAllow, true);
        }
        if (c.lens != address(0)) {
            core.setNadfunLens(c.lens);
        }

        vm.stopBroadcast();

        console2.log("DEPLOY_OWNER", c.owner);
        console2.log("INTENT_BOOK", c.intentBook);
        console2.log("VAULT", address(vault));
        console2.log("CORE", address(core));
        console2.log("ADAPTER", address(adapter));
        console2.log("WMON", c.wmon);
        console2.log("BONDING_ROUTER", c.bondingRouter);
        console2.log("DEX_ROUTER", c.dexRouter);
        if (c.lens != address(0)) {
            console2.log("NADFUN_LENS", c.lens);
        }
        if (c.targetTokenToAllow != address(0)) {
            console2.log("TARGET_TOKEN_ALLOWED", c.targetTokenToAllow);
        }
    }

    function _loadConfig(uint256 pk) internal view returns (Config memory c) {
        c.owner = vm.addr(pk);
        c.intentBook = vm.envAddress("INTENT_BOOK_ADDRESS");
        c.wmon = vm.envAddress("NADFUN_WMON_ADDRESS");
        c.bondingRouter = vm.envAddress("NADFUN_BONDING_CURVE_ROUTER");
        c.dexRouter = vm.envAddress("NADFUN_DEX_ROUTER");
        c.lens = vm.envOr("NADFUN_LENS_ADDRESS", address(0));
        c.vaultName = vm.envOr("CLAW_VAULT_NAME", string("Claw Vault Share"));
        c.vaultSymbol = vm.envOr("CLAW_VAULT_SYMBOL", string("clSHARE"));
        c.targetTokenToAllow = vm.envOr("TARGET_TOKEN_TO_ALLOW", address(0));
    }
}
