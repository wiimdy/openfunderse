// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ClawFundFactory} from "../src/ClawFundFactory.sol";

contract DeployClawFundFactory is Script {
    function run() external returns (ClawFundFactory factory) {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address factoryOwner = vm.envOr("FACTORY_OWNER", deployer);

        vm.startBroadcast(deployerPk);
        factory = new ClawFundFactory(factoryOwner);
        vm.stopBroadcast();

        console2.log("FACTORY", address(factory));
        console2.log("FACTORY_OWNER", factoryOwner);
        console2.log("INTENT_BOOK_IMPLEMENTATION", factory.intentBookImplementation());
        console2.log("CORE_IMPLEMENTATION", factory.coreImplementation());
        console2.log("VAULT_IMPLEMENTATION", factory.vaultImplementation());
    }
}
