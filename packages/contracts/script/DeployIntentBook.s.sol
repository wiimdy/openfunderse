// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {MockSnapshotBook} from "../src/mocks/MockSnapshotBook.sol";

contract DeployIntentBookScript is Script {
    bytes32 internal constant DEFAULT_SNAPSHOT_HASH = keccak256("openclaw-local-snapshot-v1");

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerPk);
        address strategy = vm.envOr("STRATEGY_AGENT", owner);
        uint256 thresholdWeight = vm.envOr("INTENT_THRESHOLD_WEIGHT", uint256(5));

        vm.startBroadcast(deployerPk);

        MockSnapshotBook snapshotBook = new MockSnapshotBook();
        snapshotBook.setFinalized(DEFAULT_SNAPSHOT_HASH, true);

        IntentBook intentBook = new IntentBook(owner, strategy, address(snapshotBook), thresholdWeight);

        vm.stopBroadcast();

        console2.log("OWNER", owner);
        console2.log("STRATEGY_AGENT", strategy);
        console2.log("SNAPSHOT_BOOK", address(snapshotBook));
        console2.log("INTENT_BOOK", address(intentBook));
        console2.logBytes32(DEFAULT_SNAPSHOT_HASH);
    }
}
