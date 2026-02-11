// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISnapshotBook {
    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool);
}

/// @title ClaimBook v0
/// @notice Crawler submits claims; verifiers attest via EIP-712 signatures; threshold marks claims final.
contract ClaimBook is ISnapshotBook {
    struct ClaimMeta {
        bytes32 schemaId;
        string sourceType;
        uint64 timestamp;
        uint64 epochId;
    }

    struct Claim {
        bytes32 claimHash;
        string claimURI;
        address crawler;
        ClaimMeta meta;
        bool finalized;
        uint256 attestedWeight;
        uint256 thresholdWeight;
    }

    struct ClaimAttestation {
        uint64 expiresAt;
        uint256 nonce;
        bytes signature;
    }

    string public constant NAME = "ClawClaimBook";
    string public constant VERSION = "1";

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant CLAIM_ATTESTATION_TYPEHASH =
        keccak256("ClaimAttestation(bytes32 claimHash,uint64 epochId,address verifier,uint64 expiresAt,uint256 nonce)");

    address public owner;
    uint256 public defaultThresholdWeight;
    uint256 public nextClaimId = 1;

    mapping(address => bool) public isVerifier;
    mapping(address => uint256) public verifierWeight;

    mapping(uint256 => bytes32) public claimIdToHash;
    mapping(bytes32 => uint256) public claimHashToId;

    mapping(bytes32 => Claim) public claims;
    mapping(bytes32 => mapping(address => bool)) public hasAttested;
    mapping(address => mapping(uint256 => bool)) public usedNonce;

    mapping(bytes32 => bool) private _snapshotFinalized;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VerifierUpdated(address indexed verifier, bool enabled, uint256 weight);
    event ThresholdWeightUpdated(uint256 thresholdWeight);

    event ClaimSubmitted(
        bytes32 indexed claimHash,
        string claimURI,
        bytes32 indexed schemaId,
        uint64 timestamp,
        address indexed crawler
    );
    event ClaimAttested(bytes32 indexed claimHash, address indexed verifier, uint256 verifierWeight, uint256 attestedWeight);
    event ClaimFinalized(bytes32 indexed claimHash, uint256 attestedWeight, uint256 thresholdWeight);
    event SnapshotFinalized(uint64 indexed epochId, bytes32 indexed snapshotHash);

    error NotOwner();
    error InvalidAddress();
    error InvalidThreshold();
    error InvalidBatchLength();
    error ClaimAlreadyExists();
    error ClaimNotFound();
    error ClaimAlreadyFinalized();
    error ClaimNotFinalized();
    error InsufficientAttestedWeight();
    error InvalidClaimOrder();
    error ClaimEpochMismatch();
    error SnapshotAlreadyFinalized();
    error NotVerifier();
    error DuplicateAttestation();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, uint256 thresholdWeight_) {
        if (owner_ == address(0)) revert InvalidAddress();
        if (thresholdWeight_ == 0) revert InvalidThreshold();

        owner = owner_;
        defaultThresholdWeight = thresholdWeight_;

        emit OwnershipTransferred(address(0), owner_);
        emit ThresholdWeightUpdated(thresholdWeight_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setDefaultThresholdWeight(uint256 newThresholdWeight) external onlyOwner {
        if (newThresholdWeight == 0) revert InvalidThreshold();
        defaultThresholdWeight = newThresholdWeight;
        emit ThresholdWeightUpdated(newThresholdWeight);
    }

    function setVerifier(address verifier, bool enabled, uint256 weight) external onlyOwner {
        if (verifier == address(0)) revert InvalidAddress();
        if (enabled && weight == 0) revert InvalidThreshold();

        isVerifier[verifier] = enabled;
        verifierWeight[verifier] = enabled ? weight : 0;

        emit VerifierUpdated(verifier, enabled, verifierWeight[verifier]);
    }

    function submitClaim(bytes32 claimHash, string calldata claimURI, ClaimMeta calldata meta) external returns (uint256 claimId) {
        if (claims[claimHash].crawler != address(0)) revert ClaimAlreadyExists();

        claimId = nextClaimId;
        nextClaimId = claimId + 1;

        claimIdToHash[claimId] = claimHash;
        claimHashToId[claimHash] = claimId;

        Claim storage claim = claims[claimHash];
        claim.claimHash = claimHash;
        claim.claimURI = claimURI;
        claim.crawler = msg.sender;
        claim.meta = meta;
        claim.thresholdWeight = defaultThresholdWeight;

        emit ClaimSubmitted(claimHash, claimURI, meta.schemaId, meta.timestamp, msg.sender);
    }

    function attestClaim(bytes32 claimHash, address[] calldata verifiers, bytes[] calldata sigs) external {
        if (verifiers.length == 0 || verifiers.length != sigs.length) revert InvalidBatchLength();

        Claim storage claim = claims[claimHash];
        if (claim.crawler == address(0)) revert ClaimNotFound();
        if (claim.finalized) revert ClaimAlreadyFinalized();

        uint256 runningWeight = claim.attestedWeight;
        uint256 len = verifiers.length;

        for (uint256 i = 0; i < len; i++) {
            address verifier = verifiers[i];
            ClaimAttestation memory a = _decodeClaimAttestation(sigs[i]);

            if (!isVerifier[verifier]) revert NotVerifier();
            if (hasAttested[claimHash][verifier]) revert DuplicateAttestation();
            if (a.expiresAt <= block.timestamp) revert SignatureExpired();
            if (usedNonce[verifier][a.nonce]) revert NonceAlreadyUsed();

            bytes32 digest = _claimAttestationDigest(claimHash, claim.meta.epochId, verifier, a.expiresAt, a.nonce);
            address recovered = _recoverSigner(digest, a.signature);
            if (recovered != verifier) revert InvalidSignature();

            hasAttested[claimHash][verifier] = true;
            usedNonce[verifier][a.nonce] = true;

            uint256 weight = verifierWeight[verifier];
            runningWeight += weight;

            emit ClaimAttested(claimHash, verifier, weight, runningWeight);
        }

        claim.attestedWeight = runningWeight;
    }

    function finalizeClaim(bytes32 claimHash) external {
        Claim storage claim = claims[claimHash];
        if (claim.crawler == address(0)) revert ClaimNotFound();
        if (claim.finalized) revert ClaimAlreadyFinalized();
        if (claim.attestedWeight < claim.thresholdWeight) revert InsufficientAttestedWeight();

        claim.finalized = true;
        emit ClaimFinalized(claimHash, claim.attestedWeight, claim.thresholdWeight);
    }

    function finalizeSnapshot(uint64 epochId, bytes32[] calldata orderedClaimHashes) external returns (bytes32 snapshotHash) {
        uint256 len = orderedClaimHashes.length;
        if (len == 0) revert InvalidBatchLength();

        bytes32 previous;

        for (uint256 i = 0; i < len; i++) {
            bytes32 claimHash = orderedClaimHashes[i];
            if (i != 0 && claimHash <= previous) revert InvalidClaimOrder();

            Claim storage claim = claims[claimHash];
            if (claim.crawler == address(0)) revert ClaimNotFound();
            if (!claim.finalized) revert ClaimNotFinalized();
            if (claim.meta.epochId != epochId) revert ClaimEpochMismatch();

            previous = claimHash;
        }

        snapshotHash = keccak256(abi.encode(epochId, orderedClaimHashes));
        if (_snapshotFinalized[snapshotHash]) revert SnapshotAlreadyFinalized();

        _snapshotFinalized[snapshotHash] = true;

        emit SnapshotFinalized(epochId, snapshotHash);
    }

    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool) {
        return _snapshotFinalized[snapshotHash];
    }

    function getClaim(bytes32 claimHash) external view returns (Claim memory) {
        return claims[claimHash];
    }

    function _decodeClaimAttestation(bytes calldata encoded) internal pure returns (ClaimAttestation memory a) {
        (a.expiresAt, a.nonce, a.signature) = abi.decode(encoded, (uint64, uint256, bytes));
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function _claimAttestationDigest(
        bytes32 claimHash,
        uint64 epochId,
        address verifier,
        uint64 expiresAt,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_ATTESTATION_TYPEHASH, claimHash, epochId, verifier, expiresAt, nonce)
        );

        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}
