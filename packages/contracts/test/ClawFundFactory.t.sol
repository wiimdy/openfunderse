// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ClawFundFactory} from "../src/ClawFundFactory.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";
import {MockSnapshotBook} from "../src/mocks/MockSnapshotBook.sol";

contract ClawFundFactoryTest is Test {
    address internal factoryOwner = makeAddr("factoryOwner");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal fundOwner = makeAddr("fundOwner");
    address internal strategy = makeAddr("strategy");
    address internal asset = makeAddr("asset");
    address internal lens = makeAddr("lens");
    address internal verifier1 = makeAddr("verifier1");
    address internal verifier2 = makeAddr("verifier2");
    address internal token1 = makeAddr("token1");
    address internal adapter1 = makeAddr("adapter1");

    ClawFundFactory internal factory;
    MockSnapshotBook internal snapshots;

    function setUp() external {
        factory = new ClawFundFactory(factoryOwner);
        snapshots = new MockSnapshotBook();

        vm.prank(factoryOwner);
        factory.setFactoryOperator(operator, true);
    }

    function testCreateFundDeploysAndConfiguresStack() external {
        ClawFundFactory.DeployConfig memory cfg = _baseConfig();

        address[] memory verifiers = new address[](2);
        uint256[] memory verifierWeights = new uint256[](2);
        verifiers[0] = verifier1;
        verifiers[1] = verifier2;
        verifierWeights[0] = 3;
        verifierWeights[1] = 2;
        cfg.initialVerifiers = verifiers;
        cfg.initialVerifierWeights = verifierWeights;

        address[] memory allowedTokens = new address[](1);
        allowedTokens[0] = token1;
        cfg.initialAllowedTokens = allowedTokens;

        address[] memory allowedAdapters = new address[](1);
        allowedAdapters[0] = adapter1;
        cfg.initialAllowedAdapters = allowedAdapters;

        vm.prank(operator);
        (uint256 fundId, address intentBookAddr, address coreAddr, address vaultAddr) = factory.createFund(cfg);

        assertEq(fundId, 1);
        assertEq(factory.fundCount(), 1);

        IntentBook book = IntentBook(intentBookAddr);
        ClawCore core = ClawCore(coreAddr);
        ClawVault4626 vault = ClawVault4626(payable(vaultAddr));

        assertEq(book.owner(), fundOwner);
        assertEq(book.strategyAgent(), strategy);
        assertEq(address(book.snapshotBook()), address(snapshots));
        assertEq(book.defaultThresholdWeight(), 5);
        assertTrue(book.isVerifier(verifier1));
        assertTrue(book.isVerifier(verifier2));
        assertEq(book.verifierWeight(verifier1), 3);
        assertEq(book.verifierWeight(verifier2), 2);

        assertEq(core.owner(), fundOwner);
        assertEq(core.guardian(), fundOwner);
        assertEq(address(core.intentBook()), intentBookAddr);
        assertEq(address(core.vault()), vaultAddr);
        assertEq(core.nadfunLens(), lens);

        assertEq(vault.owner(), fundOwner);
        assertEq(vault.guardian(), fundOwner);
        assertEq(vault.core(), coreAddr);
        assertEq(vault.asset(), asset);
        assertTrue(vault.isTokenAllowed(asset));
        assertTrue(vault.isTokenAllowed(token1));
        assertTrue(vault.isAdapterAllowed(adapter1));

        ClawFundFactory.FundDeployment memory stored = factory.getFund(fundId);
        assertEq(stored.fundOwner, fundOwner);
        assertEq(stored.strategyAgent, strategy);
        assertEq(stored.snapshotBook, address(snapshots));
        assertEq(stored.asset, asset);
        assertEq(stored.intentBook, intentBookAddr);
        assertEq(stored.core, coreAddr);
        assertEq(stored.vault, vaultAddr);
        assertEq(stored.createdAt, uint64(block.timestamp));
    }

    function testCreateFundDefaultsStrategyToFundOwner() external {
        ClawFundFactory.DeployConfig memory cfg = _baseConfig();
        cfg.strategyAgent = address(0);

        vm.prank(operator);
        (, address intentBookAddr,,) = factory.createFund(cfg);

        IntentBook book = IntentBook(intentBookAddr);
        assertEq(book.strategyAgent(), fundOwner);
    }

    function testCreateFundRevertsWhenCallerIsNotOperator() external {
        ClawFundFactory.DeployConfig memory cfg = _baseConfig();

        vm.prank(stranger);
        vm.expectRevert(ClawFundFactory.NotFactoryOperator.selector);
        factory.createFund(cfg);
    }

    function testCreateFundRevertsWhenVerifierArrayLengthMismatch() external {
        ClawFundFactory.DeployConfig memory cfg = _baseConfig();
        cfg.initialVerifiers = new address[](2);
        cfg.initialVerifierWeights = new uint256[](1);

        vm.prank(operator);
        vm.expectRevert(ClawFundFactory.InvalidArrayLength.selector);
        factory.createFund(cfg);
    }

    function testOnlyOwnerCanManageOperators() external {
        vm.prank(stranger);
        vm.expectRevert();
        factory.setFactoryOperator(stranger, true);

        vm.prank(factoryOwner);
        factory.setFactoryOperator(stranger, true);
        assertTrue(factory.isFactoryOperator(stranger));
    }

    function _baseConfig() internal view returns (ClawFundFactory.DeployConfig memory cfg) {
        cfg.fundOwner = fundOwner;
        cfg.strategyAgent = strategy;
        cfg.snapshotBook = address(snapshots);
        cfg.asset = asset;
        cfg.vaultName = "Fund Vault Share";
        cfg.vaultSymbol = "FVS";
        cfg.intentThresholdWeight = 5;
        cfg.nadfunLens = lens;
        cfg.initialVerifiers = new address[](0);
        cfg.initialVerifierWeights = new uint256[](0);
        cfg.initialAllowedTokens = new address[](0);
        cfg.initialAllowedAdapters = new address[](0);
    }
}
