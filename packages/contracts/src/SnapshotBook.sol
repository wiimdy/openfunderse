// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SnapshotBook v0
/// @notice Minimal onchain registry for epoch snapshot roots (Merkle roots).
/// @dev IntentBook queries `isSnapshotFinalized(snapshotHash)` where snapshotHash is a Merkle root.
contract SnapshotBook {
    /// @notice Unix timestamp of when a snapshot root was published (0 == not published).
    mapping(bytes32 => uint64) public publishedAt;

    event SnapshotPublished(bytes32 indexed snapshotRoot, address indexed publisher, uint64 publishedAt);

    error InvalidSnapshotRoot();

    /// @notice Publish a snapshot root (idempotent).
    /// @dev Anyone can publish; correctness is enforced offchain by verifiers.
    function publishSnapshot(bytes32 snapshotRoot) external {
        if (snapshotRoot == bytes32(0)) revert InvalidSnapshotRoot();
        if (publishedAt[snapshotRoot] != 0) return;

        uint64 ts = uint64(block.timestamp);
        publishedAt[snapshotRoot] = ts;
        emit SnapshotPublished(snapshotRoot, msg.sender, ts);
    }

    /// @notice Compatibility with IntentBook.
    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool) {
        return publishedAt[snapshotHash] != 0;
    }

    /// @notice Verify that a claimHash is included in the snapshot root via a Merkle proof.
    /// @dev Returns false if the snapshot root hasn't been published.
    function verifyClaim(bytes32 snapshotRoot, bytes32 claimHash, bytes32[] calldata proof) external view returns (bool) {
        if (publishedAt[snapshotRoot] == 0) return false;
        return MerkleProof.verifyCalldata(proof, snapshotRoot, claimHash);
    }
}
