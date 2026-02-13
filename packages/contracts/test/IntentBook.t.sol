// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IntentBook, ISnapshotBook} from "../src/IntentBook.sol";

contract MockSnapshotBook is ISnapshotBook {
    mapping(bytes32 => bool) public finalized;

    function setFinalized(bytes32 snapshotHash, bool isFinalized) external {
        finalized[snapshotHash] = isFinalized;
    }

    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool) {
        return finalized[snapshotHash];
    }
}

contract IntentBookTest is Test {
    uint256 internal constant PK_STRATEGY = 0xA11CE;
    uint256 internal constant PK_V1 = 0xB0B;
    uint256 internal constant PK_V2 = 0xC0C;

    address internal owner = makeAddr("owner");
    address internal strategy = vm.addr(PK_STRATEGY);
    address internal verifier1 = vm.addr(PK_V1);
    address internal verifier2 = vm.addr(PK_V2);

    MockSnapshotBook internal snapshots;
    IntentBook internal book;

    bytes32 internal snapshotHash = keccak256("snapshot-1");
    bytes32 internal intentHash = keccak256("intent-1");
    uint256 internal constant SECP256K1N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() external {
        snapshots = new MockSnapshotBook();
        snapshots.setFinalized(snapshotHash, true);

        book = _deployIntentBook(owner, strategy, address(snapshots), 5);

        vm.startPrank(owner);
        book.setVerifier(verifier1, true, 3);
        book.setVerifier(verifier2, true, 2);
        vm.stopPrank();
    }

    function _deployIntentBook(address owner_, address strategy_, address snapshotBook_, uint256 threshold)
        internal
        returns (IntentBook deployed)
    {
        IntentBook impl = new IntentBook();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl), abi.encodeCall(IntentBook.initialize, (owner_, strategy_, snapshotBook_, threshold))
        );
        deployed = IntentBook(address(proxy));
    }

    function _constraints(uint64 deadline) internal pure returns (IntentBook.Constraints memory c) {
        c = IntentBook.Constraints({
            allowlistHash: bytes32(uint256(1)),
            maxSlippageBps: 50,
            maxNotional: 1_000_000e18,
            deadline: deadline
        });
    }

    function _digest(bytes32 _intentHash, address verifier, uint64 expiresAt, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainTypehash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 attTypehash = keccak256(
            "IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)"
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                domainTypehash,
                keccak256(bytes("ClawIntentBook")),
                keccak256(bytes("1")),
                block.chainid,
                address(book)
            )
        );

        bytes32 structHash = keccak256(abi.encode(attTypehash, _intentHash, verifier, expiresAt, nonce));

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _toHighS(bytes memory sig) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        uint8 fixedV = v < 27 ? v + 27 : v;
        uint8 highV = fixedV == 27 ? 28 : 27;
        bytes32 highS = bytes32(SECP256K1N - uint256(s));
        return abi.encodePacked(r, highS, highV);
    }

    function testProposeIntentEmitsAndStores() external {
        uint64 deadline = uint64(block.timestamp + 1 hours);

        vm.expectEmit(true, false, true, true);
        emit IntentBook.IntentProposed(intentHash, "ipfs://intent", snapshotHash, strategy);

        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(deadline));

        IntentBook.Intent memory i = book.getIntent(intentHash);

        assertEq(i.intentHash, intentHash);
        assertEq(i.intentURI, "ipfs://intent");
        assertEq(i.snapshotHash, snapshotHash);
        assertEq(i.proposer, strategy);
        assertEq(i.constraints.deadline, deadline);
        assertFalse(i.approved);
        assertEq(i.thresholdWeight, 5);
    }

    function testProposeIntentRevertsWhenSnapshotMismatch() external {
        bytes32 badSnapshot = keccak256("unknown-snapshot");

        vm.prank(strategy);
        vm.expectRevert(IntentBook.SnapshotNotFinalized.selector);
        book.proposeIntent(intentHash, "ipfs://intent", badSnapshot, _constraints(uint64(block.timestamp + 1))); 
    }

    function testProposeIntentRevertsWhenExpiredDeadline() external {
        vm.prank(strategy);
        vm.expectRevert(IntentBook.IntentExpired.selector);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp)));
    }

    function testAttestIntentApprovesAtThreshold() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](2);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](2);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        verifiers[1] = verifier2;
        atts[1] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 2,
            signature: _sign(PK_V2, _digest(intentHash, verifier2, expiresAt, 2))
        });

        vm.expectEmit(true, false, false, true);
        emit IntentBook.IntentApproved(intentHash, 5, 5);

        book.attestIntent(intentHash, verifiers, atts);

        assertTrue(book.isIntentApproved(intentHash));
    }

    function testAttestIntentRevertsOnDuplicateVerifier() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        book.attestIntent(intentHash, verifiers, atts);

        vm.expectRevert(IntentBook.DuplicateAttestation.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnUnauthorizedVerifier() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        uint256 pkUnknown = 0xDEAD;
        address unknown = vm.addr(pkUnknown);

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = unknown;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(pkUnknown, _digest(intentHash, unknown, expiresAt, 1))
        });

        vm.expectRevert(IntentBook.NotVerifier.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnExpiredAttestation() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp - 1);
        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        vm.expectRevert(IntentBook.SignatureExpired.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnIntentDeadlineReached() external {
        uint64 deadline = uint64(block.timestamp + 1);
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(deadline));

        vm.warp(block.timestamp + 2);

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        vm.expectRevert(IntentBook.IntentExpired.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnNonceReplay() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 7,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 7))
        });

        book.attestIntent(intentHash, verifiers, atts);

        bytes32 intentHash2 = keccak256("intent-2");
        vm.prank(strategy);
        book.proposeIntent(intentHash2, "ipfs://intent2", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers2 = new address[](1);
        IntentBook.IntentAttestation[] memory atts2 = new IntentBook.IntentAttestation[](1);
        verifiers2[0] = verifier1;
        atts2[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 7,
            signature: _sign(PK_V1, _digest(intentHash2, verifier1, expiresAt, 7))
        });

        vm.expectRevert(IntentBook.NonceAlreadyUsed.selector);
        book.attestIntent(intentHash2, verifiers2, atts2);
    }

    function testProposeIntentRevertsWhenCallerIsNotStrategy() external {
        vm.expectRevert(IntentBook.NotStrategyAgent.selector);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));
    }

    function testAttestIntentRevertsWhenIntentNotFound() external {
        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        vm.expectRevert(IntentBook.IntentNotFound.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsWhenBatchLengthMismatch() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](2);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = verifier1;
        verifiers[1] = verifier2;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });

        vm.expectRevert(IntentBook.InvalidBatchLength.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnInvalidSignature() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 42,
            signature: _sign(PK_V2, _digest(intentHash, verifier1, expiresAt, 42))
        });

        vm.expectRevert(IntentBook.InvalidSignature.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsOnHighSSignature() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](1);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](1);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        uint256 nonce = 222;

        verifiers[0] = verifier1;
        bytes memory lowSig = _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, nonce));
        atts[0] = IntentBook.IntentAttestation({expiresAt: expiresAt, nonce: nonce, signature: _toHighS(lowSig)});

        vm.expectRevert(IntentBook.InvalidSignature.selector);
        book.attestIntent(intentHash, verifiers, atts);
    }

    function testAttestIntentRevertsAfterAlreadyApproved() external {
        vm.prank(strategy);
        book.proposeIntent(intentHash, "ipfs://intent", snapshotHash, _constraints(uint64(block.timestamp + 1 hours)));

        address[] memory verifiers = new address[](2);
        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](2);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        verifiers[0] = verifier1;
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 1))
        });
        verifiers[1] = verifier2;
        atts[1] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 2,
            signature: _sign(PK_V2, _digest(intentHash, verifier2, expiresAt, 2))
        });

        book.attestIntent(intentHash, verifiers, atts);
        assertTrue(book.isIntentApproved(intentHash));

        address[] memory extraVerifiers = new address[](1);
        IntentBook.IntentAttestation[] memory extraAtts = new IntentBook.IntentAttestation[](1);
        extraVerifiers[0] = verifier1;
        extraAtts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 99,
            signature: _sign(PK_V1, _digest(intentHash, verifier1, expiresAt, 99))
        });

        vm.expectRevert(IntentBook.AlreadyApproved.selector);
        book.attestIntent(intentHash, extraVerifiers, extraAtts);
    }
}
