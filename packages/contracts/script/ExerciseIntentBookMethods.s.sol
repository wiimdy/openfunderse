// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {MockSnapshotBook} from "../src/mocks/MockSnapshotBook.sol";

contract ExerciseIntentBookMethodsScript is Script {
    bytes32 internal constant INTENT_ATTESTATION_TYPEHASH =
        keccak256("IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)");

    IntentBook internal book;
    MockSnapshotBook internal snapshotBook;

    uint256 internal ownerPk;
    address internal owner;

    uint256 internal verifierPk1;
    uint256 internal verifierPk2;
    address internal verifier1;
    address internal verifier2;

    bytes32 internal snapshotHash;
    bytes32 internal intentHash;

    function run() external {
        _loadConfig();

        vm.startBroadcast(ownerPk);
        _adminSetup();
        _proposeIntent();
        _attestIntent();
        vm.stopBroadcast();

        _assertState();

        console2.log("IntentBook method exercise succeeded");
        console2.log("INTENT_BOOK", address(book));
        console2.log("INTENT_HASH");
        console2.logBytes32(intentHash);
    }

    function _loadConfig() internal {
        ownerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        owner = vm.addr(ownerPk);

        book = IntentBook(vm.envAddress("INTENT_BOOK_ADDRESS"));
        snapshotBook = MockSnapshotBook(vm.envAddress("SNAPSHOT_BOOK_ADDRESS"));

        verifierPk1 = vm.envOr("TEST_VERIFIER_PK_1", uint256(0xB0B));
        verifierPk2 = vm.envOr("TEST_VERIFIER_PK_2", uint256(0xC0C));
        verifier1 = vm.addr(verifierPk1);
        verifier2 = vm.addr(verifierPk2);

        snapshotHash = keccak256("openclaw-local-snapshot-v1");
        intentHash = keccak256("openclaw-local-intent-v1");
    }

    function _adminSetup() internal {
        book.setVerifier(verifier1, true, 3);
        book.setVerifier(verifier2, true, 2);
        book.setDefaultThresholdWeight(5);
        book.setStrategyAgent(owner);
        book.setSnapshotBook(address(snapshotBook));
        snapshotBook.setFinalized(snapshotHash, true);
    }

    function _proposeIntent() internal {
        IntentBook.Constraints memory c = IntentBook.Constraints({
            allowlistHash: bytes32(uint256(1)),
            maxSlippageBps: 50,
            maxNotional: 1_000_000 ether,
            deadline: uint64(block.timestamp + 1 hours)
        });

        book.proposeIntent(intentHash, "ipfs://openclaw-intent-local", snapshotHash, c);
    }

    function _attestIntent() internal {
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);

        address[] memory verifiers = new address[](2);
        verifiers[0] = verifier1;
        verifiers[1] = verifier2;

        IntentBook.IntentAttestation[] memory atts = new IntentBook.IntentAttestation[](2);
        atts[0] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 1,
            signature: _sign(verifierPk1, _digest(intentHash, verifier1, expiresAt, 1))
        });
        atts[1] = IntentBook.IntentAttestation({
            expiresAt: expiresAt,
            nonce: 2,
            signature: _sign(verifierPk2, _digest(intentHash, verifier2, expiresAt, 2))
        });

        book.attestIntent(intentHash, verifiers, atts);
    }

    function _assertState() internal view {
        require(book.isIntentApproved(intentHash), "intent should be approved");

        IntentBook.Intent memory i = book.getIntent(intentHash);
        require(i.approved, "stored intent should be approved");
        require(i.attestedWeight == 5, "attested weight mismatch");
    }

    function _digest(bytes32 _intentHash, address verifier, uint64 expiresAt, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainTypehash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

        bytes32 domainSeparator = keccak256(
            abi.encode(
                domainTypehash,
                keccak256(bytes("ClawIntentBook")),
                keccak256(bytes("1")),
                block.chainid,
                address(book)
            )
        );

        bytes32 structHash =
            keccak256(abi.encode(INTENT_ATTESTATION_TYPEHASH, _intentHash, verifier, expiresAt, nonce));

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
