// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IntentBook} from "./IntentBook.sol";
import {ClawCore} from "./ClawCore.sol";
import {ClawVault4626} from "./ClawVault4626.sol";

/// @title ClawFundFactory
/// @notice Admin-facing factory for spinning up isolated fund stacks in one transaction.
/// @dev Each created fund gets its own IntentBook, ClawCore, and ClawVault4626 proxy.
contract ClawFundFactory is Ownable {
    struct DeployConfig {
        address fundOwner;
        address strategyAgent;
        address snapshotBook;
        address asset;
        string vaultName;
        string vaultSymbol;
        uint256 intentThresholdWeight;
        address nadfunLens;
        address[] initialVerifiers;
        uint256[] initialVerifierWeights;
        address[] initialAllowedTokens;
        address[] initialAllowedAdapters;
    }

    struct FundDeployment {
        address fundOwner;
        address strategyAgent;
        address snapshotBook;
        address asset;
        address intentBook;
        address core;
        address vault;
        uint64 createdAt;
    }

    struct DeployedContracts {
        IntentBook intentBook;
        ClawCore core;
        ClawVault4626 vault;
    }

    address public immutable intentBookImplementation;
    address public immutable coreImplementation;
    address public immutable vaultImplementation;

    uint256 public fundCount;

    mapping(uint256 => FundDeployment) public funds;
    mapping(address => bool) public isFactoryOperator;

    event FactoryOperatorUpdated(address indexed operator, bool allowed);
    event FundDeployed(
        uint256 indexed fundId,
        address indexed fundOwner,
        address indexed strategyAgent,
        address intentBook,
        address core,
        address vault,
        address snapshotBook,
        address asset
    );

    error NotFactoryOperator();
    error InvalidAddress();
    error InvalidThreshold();
    error InvalidArrayLength();
    error InvalidVerifierConfig();

    modifier onlyFactoryOperator() {
        if (msg.sender != owner() && !isFactoryOperator[msg.sender]) revert NotFactoryOperator();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        intentBookImplementation = address(new IntentBook());
        coreImplementation = address(new ClawCore());
        vaultImplementation = address(new ClawVault4626());
    }

    function setFactoryOperator(address operator, bool allowed) external onlyOwner {
        if (operator == address(0)) revert InvalidAddress();
        isFactoryOperator[operator] = allowed;
        emit FactoryOperatorUpdated(operator, allowed);
    }

    function createFund(DeployConfig calldata cfg)
        external
        onlyFactoryOperator
        returns (uint256 fundId, address intentBook, address core, address vault)
    {
        if (cfg.fundOwner == address(0) || cfg.snapshotBook == address(0) || cfg.asset == address(0)) {
            revert InvalidAddress();
        }
        if (cfg.intentThresholdWeight == 0) revert InvalidThreshold();
        if (cfg.initialVerifiers.length != cfg.initialVerifierWeights.length) revert InvalidArrayLength();

        address strategy = cfg.strategyAgent == address(0) ? cfg.fundOwner : cfg.strategyAgent;
        if (strategy == address(0)) revert InvalidAddress();

        DeployedContracts memory deployed = _deployFundContracts(cfg, strategy);

        deployed.vault.setCore(address(deployed.core));
        if (cfg.nadfunLens != address(0)) {
            deployed.core.setNadfunLens(cfg.nadfunLens);
        }

        _configureVerifiers(deployed.intentBook, cfg.initialVerifiers, cfg.initialVerifierWeights);
        _configureAllowedTokens(deployed.vault, cfg.initialAllowedTokens);
        _configureAllowedAdapters(deployed.vault, cfg.initialAllowedAdapters);

        // Remove factory privileges after setup.
        _finalizeOwnership(deployed, cfg.fundOwner);

        fundId = ++fundCount;
        intentBook = address(deployed.intentBook);
        core = address(deployed.core);
        vault = address(deployed.vault);

        funds[fundId] = FundDeployment({
            fundOwner: cfg.fundOwner,
            strategyAgent: strategy,
            snapshotBook: cfg.snapshotBook,
            asset: cfg.asset,
            intentBook: intentBook,
            core: core,
            vault: vault,
            createdAt: uint64(block.timestamp)
        });

        emit FundDeployed(fundId, cfg.fundOwner, strategy, intentBook, core, vault, cfg.snapshotBook, cfg.asset);
    }

    function _deployFundContracts(DeployConfig calldata cfg, address strategy)
        internal
        returns (DeployedContracts memory deployed)
    {
        deployed.intentBook = IntentBook(
            address(
                new ERC1967Proxy(
                    intentBookImplementation,
                    abi.encodeCall(
                        IntentBook.initialize,
                        (address(this), strategy, cfg.snapshotBook, cfg.intentThresholdWeight)
                    )
                )
            )
        );

        deployed.vault = ClawVault4626(
            payable(
                address(
                    new ERC1967Proxy(
                        vaultImplementation,
                        abi.encodeCall(ClawVault4626.initialize, (address(this), cfg.asset, cfg.vaultName, cfg.vaultSymbol))
                    )
                )
            )
        );

        deployed.core = ClawCore(
            address(
                new ERC1967Proxy(
                    coreImplementation,
                    abi.encodeCall(
                        ClawCore.initialize, (address(this), address(deployed.intentBook), address(deployed.vault))
                    )
                )
            )
        );
    }

    function _finalizeOwnership(DeployedContracts memory deployed, address fundOwner) internal {
        deployed.intentBook.transferOwnership(fundOwner);

        deployed.core.setGuardian(fundOwner);
        deployed.core.transferOwnership(fundOwner);

        deployed.vault.setGuardian(fundOwner);
        deployed.vault.transferOwnership(fundOwner);
    }

    function _configureVerifiers(
        IntentBook deployedIntentBook,
        address[] calldata verifiers,
        uint256[] calldata verifierWeights
    ) internal {
        uint256 len = verifiers.length;
        for (uint256 i = 0; i < len; i++) {
            address verifier = verifiers[i];
            uint256 weight = verifierWeights[i];
            if (verifier == address(0) || weight == 0) revert InvalidVerifierConfig();
            deployedIntentBook.setVerifier(verifier, true, weight);
        }
    }

    function _configureAllowedTokens(ClawVault4626 deployedVault, address[] calldata tokens) internal {
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; i++) {
            address token = tokens[i];
            if (token == address(0)) revert InvalidAddress();
            deployedVault.setTokenAllowed(token, true);
        }
    }

    function _configureAllowedAdapters(ClawVault4626 deployedVault, address[] calldata adapters) internal {
        uint256 len = adapters.length;
        for (uint256 i = 0; i < len; i++) {
            address adapter = adapters[i];
            if (adapter == address(0)) revert InvalidAddress();
            deployedVault.setAdapterAllowed(adapter, true);
        }
    }

    function getFund(uint256 fundId) external view returns (FundDeployment memory) {
        return funds[fundId];
    }
}
