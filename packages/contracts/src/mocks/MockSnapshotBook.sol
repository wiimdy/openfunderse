// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockSnapshotBook {
    mapping(bytes32 => bool) public finalized;

    function setFinalized(bytes32 snapshotHash, bool isFinalized) external {
        finalized[snapshotHash] = isFinalized;
    }

    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool) {
        return finalized[snapshotHash];
    }
}
