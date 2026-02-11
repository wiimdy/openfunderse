// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISnapshotBook {
    function isSnapshotFinalized(bytes32 snapshotHash) external view returns (bool);
}

/// @title IntentBook v0
/// @notice Strategy proposes intent; verifiers attest via EIP-712 signatures; threshold turns intent Approved.
contract IntentBook {
    struct Constraints {
        bytes32 allowlistHash;
        uint16 maxSlippageBps;
        uint256 maxNotional;
        uint64 deadline;
    }

    struct Intent {
        bytes32 intentHash;
        string intentURI;
        bytes32 snapshotHash;
        address proposer;
        Constraints constraints;
        bool approved;
        uint256 attestedWeight;
        uint256 thresholdWeight;
    }

    struct IntentAttestation {
        uint64 expiresAt;
        uint256 nonce;
        bytes signature;
    }

    string public constant NAME = "ClawIntentBook";
    string public constant VERSION = "1";

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant INTENT_ATTESTATION_TYPEHASH =
        keccak256("IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)");

    address public owner;
    address public strategyAgent;
    ISnapshotBook public snapshotBook;

    uint256 public defaultThresholdWeight;

    mapping(address => bool) public isVerifier;
    mapping(address => uint256) public verifierWeight;

    mapping(bytes32 => Intent) public intents;
    mapping(bytes32 => mapping(address => bool)) public hasAttested;
    mapping(address => mapping(uint256 => bool)) public usedNonce;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event StrategyAgentUpdated(address indexed strategyAgent);
    event VerifierUpdated(address indexed verifier, bool enabled, uint256 weight);
    event ThresholdWeightUpdated(uint256 thresholdWeight);

    event IntentProposed(bytes32 indexed intentHash, string intentURI, bytes32 indexed snapshotHash, address indexed proposer);
    event IntentAttested(bytes32 indexed intentHash, address indexed verifier, uint256 verifierWeight, uint256 attestedWeight);
    event IntentApproved(bytes32 indexed intentHash, uint256 attestedWeight, uint256 thresholdWeight);

    error NotOwner();
    error NotStrategyAgent();
    error InvalidAddress();
    error InvalidThreshold();
    error SnapshotNotFinalized();
    error IntentAlreadyExists();
    error IntentNotFound();
    error IntentExpired();
    error AlreadyApproved();
    error InvalidBatchLength();
    error NotVerifier();
    error DuplicateAttestation();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyStrategyAgent() {
        if (msg.sender != strategyAgent) revert NotStrategyAgent();
        _;
    }

    constructor(address owner_, address strategyAgent_, address snapshotBook_, uint256 thresholdWeight_) {
        if (owner_ == address(0) || strategyAgent_ == address(0) || snapshotBook_ == address(0)) {
            revert InvalidAddress();
        }
        if (thresholdWeight_ == 0) revert InvalidThreshold();

        owner = owner_;
        strategyAgent = strategyAgent_;
        snapshotBook = ISnapshotBook(snapshotBook_);
        defaultThresholdWeight = thresholdWeight_;

        emit OwnershipTransferred(address(0), owner_);
        emit StrategyAgentUpdated(strategyAgent_);
        emit ThresholdWeightUpdated(thresholdWeight_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setStrategyAgent(address newStrategyAgent) external onlyOwner {
        if (newStrategyAgent == address(0)) revert InvalidAddress();
        strategyAgent = newStrategyAgent;
        emit StrategyAgentUpdated(newStrategyAgent);
    }

    function setSnapshotBook(address newSnapshotBook) external onlyOwner {
        if (newSnapshotBook == address(0)) revert InvalidAddress();
        snapshotBook = ISnapshotBook(newSnapshotBook);
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

    function proposeIntent(
        bytes32 intentHash,
        string calldata intentURI,
        bytes32 snapshotHash,
        Constraints calldata constraints
    ) external onlyStrategyAgent {
        if (!snapshotBook.isSnapshotFinalized(snapshotHash)) revert SnapshotNotFinalized();
        if (constraints.deadline <= block.timestamp) revert IntentExpired();
        if (intents[intentHash].proposer != address(0)) revert IntentAlreadyExists();

        Intent storage intent = intents[intentHash];
        intent.intentHash = intentHash;
        intent.intentURI = intentURI;
        intent.snapshotHash = snapshotHash;
        intent.proposer = msg.sender;
        intent.constraints = constraints;
        intent.thresholdWeight = defaultThresholdWeight;

        emit IntentProposed(intentHash, intentURI, snapshotHash, msg.sender);
    }

    function attestIntent(
        bytes32 intentHash,
        address[] calldata verifiers,
        IntentAttestation[] calldata attestations
    ) external {
        if (verifiers.length == 0 || verifiers.length != attestations.length) revert InvalidBatchLength();

        Intent storage intent = intents[intentHash];
        if (intent.proposer == address(0)) revert IntentNotFound();
        if (intent.approved) revert AlreadyApproved();
        if (intent.constraints.deadline <= block.timestamp) revert IntentExpired();

        uint256 runningWeight = intent.attestedWeight;
        uint256 len = verifiers.length;

        for (uint256 i = 0; i < len; i++) {
            address verifier = verifiers[i];
            IntentAttestation calldata a = attestations[i];

            if (!isVerifier[verifier]) revert NotVerifier();
            if (hasAttested[intentHash][verifier]) revert DuplicateAttestation();
            if (a.expiresAt <= block.timestamp) revert SignatureExpired();
            if (usedNonce[verifier][a.nonce]) revert NonceAlreadyUsed();

            bytes32 digest = _intentAttestationDigest(intentHash, verifier, a.expiresAt, a.nonce);
            address recovered = _recoverSigner(digest, a.signature);
            if (recovered != verifier) revert InvalidSignature();

            hasAttested[intentHash][verifier] = true;
            usedNonce[verifier][a.nonce] = true;

            uint256 weight = verifierWeight[verifier];
            runningWeight += weight;

            emit IntentAttested(intentHash, verifier, weight, runningWeight);
        }

        intent.attestedWeight = runningWeight;

        if (runningWeight >= intent.thresholdWeight) {
            intent.approved = true;
            emit IntentApproved(intentHash, runningWeight, intent.thresholdWeight);
        }
    }

    function isIntentApproved(bytes32 intentHash) external view returns (bool) {
        return intents[intentHash].approved;
    }

    function getIntent(bytes32 intentHash) external view returns (Intent memory) {
        return intents[intentHash];
    }

    /// @notice Execution-oriented lightweight view for core settlement contracts.
    function getIntentExecutionData(bytes32 intentHash)
        external
        view
        returns (
            bool exists,
            bool approved,
            bytes32 snapshotHash,
            uint64 deadline,
            uint256 maxNotional,
            bytes32 allowlistHash
        )
    {
        Intent storage intent = intents[intentHash];
        exists = intent.proposer != address(0);
        approved = intent.approved;
        snapshotHash = intent.snapshotHash;
        deadline = intent.constraints.deadline;
        maxNotional = intent.constraints.maxNotional;
        allowlistHash = intent.constraints.allowlistHash;
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

    function _intentAttestationDigest(
        bytes32 intentHash,
        address verifier,
        uint64 expiresAt,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(INTENT_ATTESTATION_TYPEHASH, intentHash, verifier, expiresAt, nonce)
        );

        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
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
