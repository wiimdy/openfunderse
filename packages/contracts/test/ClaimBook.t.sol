// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ClaimBook} from "../src/ClaimBook.sol";
import {IntentBook} from "../src/IntentBook.sol";

contract ClaimBookTest is Test {
    uint256 internal constant PK_STRATEGY = 0xA11CE;
    uint256 internal constant PK_V1 = 0xB0B;
    uint256 internal constant PK_V2 = 0xC0C;

    address internal owner = makeAddr("owner");
    address internal strategy = vm.addr(PK_STRATEGY);
    address internal crawler = makeAddr("crawler");
    address internal verifier1 = vm.addr(PK_V1);
    address internal verifier2 = vm.addr(PK_V2);

    ClaimBook internal book;

    bytes32 internal claimHash1 = keccak256("claim-1");
    bytes32 internal claimHash2 = keccak256("claim-2");
    uint64 internal epochId = 12;

    function setUp() external {
        book = new ClaimBook(owner, 5);

        vm.startPrank(owner);
        book.setVerifier(verifier1, true, 3);
        book.setVerifier(verifier2, true, 2);
        vm.stopPrank();

        vm.prank(crawler);
        book.submitClaim(claimHash1, "ipfs://claim-1", _meta(epochId, uint64(block.timestamp)));
    }

    function _meta(uint64 epoch, uint64 ts) internal pure returns (ClaimBook.ClaimMeta memory m) {
        m = ClaimBook.ClaimMeta({schemaId: bytes32(uint256(1)), sourceType: "WEB", timestamp: ts, epochId: epoch});
    }

    function _constraints(uint64 deadline) internal pure returns (IntentBook.Constraints memory c) {
        c = IntentBook.Constraints({
            allowlistHash: bytes32(uint256(1)),
            maxSlippageBps: 50,
            maxNotional: 1_000_000e18,
            deadline: deadline
        });
    }

    function _digest(bytes32 _claimHash, uint64 _epochId, address verifier, uint64 expiresAt, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainTypehash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 attTypehash = keccak256(
            "ClaimAttestation(bytes32 claimHash,uint64 epochId,address verifier,uint64 expiresAt,uint256 nonce)"
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                domainTypehash,
                keccak256(bytes("ClawClaimBook")),
                keccak256(bytes("1")),
                block.chainid,
                address(book)
            )
        );

        bytes32 structHash = keccak256(abi.encode(attTypehash, _claimHash, _epochId, verifier, expiresAt, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attestationData(
        uint256 pk,
        bytes32 _claimHash,
        uint64 _epochId,
        address verifier,
        uint64 expiresAt,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes memory sig = _sign(pk, _digest(_claimHash, _epochId, verifier, expiresAt, nonce));
        return abi.encode(expiresAt, nonce, sig);
    }

    function _submitClaim2() internal {
        vm.prank(crawler);
        book.submitClaim(claimHash2, "ipfs://claim-2", _meta(epochId, uint64(block.timestamp)));
    }

    function _attestToThreshold(bytes32 targetClaimHash) internal {
        address[] memory verifiers = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        uint256 nonceBase = uint256(targetClaimHash);

        verifiers[0] = verifier1;
        sigs[0] = _attestationData(PK_V1, targetClaimHash, epochId, verifier1, expiresAt, nonceBase + 1);

        verifiers[1] = verifier2;
        sigs[1] = _attestationData(PK_V2, targetClaimHash, epochId, verifier2, expiresAt, nonceBase + 2);

        book.attestClaim(targetClaimHash, verifiers, sigs);
    }

    function _sortedPair(bytes32 a, bytes32 b) internal pure returns (bytes32 first, bytes32 second) {
        if (a < b) return (a, b);
        return (b, a);
    }

    function testSubmitClaimEmitsAndStores() external {
        bytes32 claimHash = keccak256("claim-submit");
        uint64 ts = uint64(block.timestamp + 1);

        vm.expectEmit(true, true, false, true);
        emit ClaimBook.ClaimSubmitted(claimHash, "ipfs://claim-submit", bytes32(uint256(1)), ts, crawler);

        vm.prank(crawler);
        book.submitClaim(claimHash, "ipfs://claim-submit", _meta(epochId, ts));

        ClaimBook.Claim memory c = book.getClaim(claimHash);
        assertEq(c.claimHash, claimHash);
        assertEq(c.claimURI, "ipfs://claim-submit");
        assertEq(c.meta.schemaId, bytes32(uint256(1)));
        assertEq(c.meta.sourceType, "WEB");
        assertEq(c.meta.timestamp, ts);
        assertEq(c.meta.epochId, epochId);
        assertEq(c.crawler, crawler);
        assertFalse(c.finalized);
        assertEq(c.thresholdWeight, 5);
    }

    function testAttestClaimTracksWeightThenFinalizeClaim() external {
        _attestToThreshold(claimHash1);

        ClaimBook.Claim memory beforeFinalize = book.getClaim(claimHash1);
        assertEq(beforeFinalize.attestedWeight, 5);
        assertFalse(beforeFinalize.finalized);

        vm.expectEmit(true, false, false, true);
        emit ClaimBook.ClaimFinalized(claimHash1, 5, 5);

        book.finalizeClaim(claimHash1);

        ClaimBook.Claim memory afterFinalize = book.getClaim(claimHash1);
        assertTrue(afterFinalize.finalized);
    }

    function testAttestClaimRevertsOnDuplicateVerifier() external {
        address[] memory verifiers = new address[](1);
        bytes[] memory sigs = new bytes[](1);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier1;
        sigs[0] = _attestationData(PK_V1, claimHash1, epochId, verifier1, expiresAt, 1);

        book.attestClaim(claimHash1, verifiers, sigs);

        vm.expectRevert(ClaimBook.DuplicateAttestation.selector);
        book.attestClaim(claimHash1, verifiers, sigs);
    }

    function testAttestClaimRevertsOnNonceReplayAcrossClaims() external {
        _submitClaim2();

        address[] memory verifiers = new address[](1);
        bytes[] memory sigs = new bytes[](1);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier1;
        sigs[0] = _attestationData(PK_V1, claimHash1, epochId, verifier1, expiresAt, 7);
        book.attestClaim(claimHash1, verifiers, sigs);

        bytes[] memory sigs2 = new bytes[](1);
        sigs2[0] = _attestationData(PK_V1, claimHash2, epochId, verifier1, expiresAt, 7);

        vm.expectRevert(ClaimBook.NonceAlreadyUsed.selector);
        book.attestClaim(claimHash2, verifiers, sigs2);
    }

    function testFinalizeSnapshotMarksSnapshotAndSupportsIntentBook() external {
        _submitClaim2();
        _attestToThreshold(claimHash1);
        _attestToThreshold(claimHash2);

        book.finalizeClaim(claimHash1);
        book.finalizeClaim(claimHash2);

        (bytes32 first, bytes32 second) = _sortedPair(claimHash1, claimHash2);
        bytes32[] memory ordered = new bytes32[](2);
        ordered[0] = first;
        ordered[1] = second;

        bytes32 snapshotHash = book.finalizeSnapshot(epochId, ordered);
        assertTrue(book.isSnapshotFinalized(snapshotHash));

        IntentBook intentBook = new IntentBook(owner, strategy, address(book), 1);
        bytes32 intentHash = keccak256("intent-1");

        vm.prank(strategy);
        intentBook.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        IntentBook.Intent memory i = intentBook.getIntent(intentHash);
        assertEq(i.snapshotHash, snapshotHash);
    }

    function testFinalizeSnapshotRevertsWhenHashesNotSorted() external {
        _submitClaim2();
        _attestToThreshold(claimHash1);
        _attestToThreshold(claimHash2);

        book.finalizeClaim(claimHash1);
        book.finalizeClaim(claimHash2);

        (bytes32 first, bytes32 second) = _sortedPair(claimHash1, claimHash2);
        bytes32[] memory notSorted = new bytes32[](2);
        notSorted[0] = second;
        notSorted[1] = first;

        vm.expectRevert(ClaimBook.InvalidClaimOrder.selector);
        book.finalizeSnapshot(epochId, notSorted);
    }
}
