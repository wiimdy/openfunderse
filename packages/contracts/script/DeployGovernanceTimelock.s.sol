// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract DeployGovernanceTimelock is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY_SECONDS", uint256(2 days));
        address proposer = vm.envOr("TIMELOCK_PROPOSER", deployer);
        address executor = vm.envOr("TIMELOCK_EXECUTOR", deployer);
        address admin = vm.envOr("TIMELOCK_ADMIN", deployer);

        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = executor;

        vm.startBroadcast(deployerPk);
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, admin);
        vm.stopBroadcast();

        console2.log("TIMELOCK", address(timelock));
        console2.log("MIN_DELAY_SECONDS", minDelay);
        console2.log("PROPOSER", proposer);
        console2.log("EXECUTOR", executor);
        console2.log("ADMIN", admin);
    }
}
