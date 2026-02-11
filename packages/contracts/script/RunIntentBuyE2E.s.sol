// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {IntentBook} from "../src/IntentBook.sol";
import {ClawCore} from "../src/ClawCore.sol";
import {ClawVault4626} from "../src/ClawVault4626.sol";

interface IERC20MinimalLike {
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWMONLike {
    function deposit() external payable;
}

contract RunIntentBuyE2E is Script {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant INTENT_ATTESTATION_TYPEHASH =
        keccak256("IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)");

    struct Cfg {
        uint256 deployerPk;
        uint256 verifierPk;
        address verifier;
        address intentBookAddr;
        address coreAddr;
        address vaultAddr;
        address wmon;
        address tokenOut;
        address adapter;
        bytes32 intentHash;
        bytes32 snapshotHash;
        bytes32 allowlistHash;
        bytes adapterData;
        uint256 amountIn;
        uint256 quoteAmountOut;
        uint256 minAmountOut;
        uint16 maxSlippageBps;
        uint64 deadline;
        uint64 sigExpiresAt;
        uint256 attestationNonce;
    }

    function run() external {
        Cfg memory c = _loadCfg();

        IntentBook book = IntentBook(c.intentBookAddr);
        ClawCore core = ClawCore(c.coreAddr);
        ClawVault4626 vault = ClawVault4626(c.vaultAddr);

        vm.startBroadcast(c.deployerPk);

        // 1) Fund vault by wrapping MON -> WMON, then depositing WMON.
        IWMONLike(c.wmon).deposit{value: c.amountIn}();
        IERC20MinimalLike(c.wmon).approve(c.vaultAddr, c.amountIn);
        vault.deposit(c.amountIn, vm.addr(c.deployerPk));

        // 2) Propose intent.
        IntentBook.Constraints memory constraints = IntentBook.Constraints({
            allowlistHash: c.allowlistHash,
            maxSlippageBps: c.maxSlippageBps,
            maxNotional: c.amountIn,
            deadline: c.deadline
        });
        book.proposeIntent(c.intentHash, "ipfs://nadfun-buy-e2e", c.snapshotHash, constraints);

        // 3) Attest intent (single verifier, threshold=1 expected in deploy script default).
        bytes32 digest = _intentAttestationDigest(c.intentBookAddr, c.intentHash, c.verifier, c.sigExpiresAt, c.attestationNonce);
        bytes memory signature = _sign(c.verifierPk, digest);

        address[] memory verifiers = new address[](1);
        verifiers[0] = c.verifier;
        IntentBook.IntentAttestation[] memory attestations = new IntentBook.IntentAttestation[](1);
        attestations[0] = IntentBook.IntentAttestation({
            expiresAt: c.sigExpiresAt,
            nonce: c.attestationNonce,
            signature: signature
        });
        book.attestIntent(c.intentHash, verifiers, attestations);

        require(book.isIntentApproved(c.intentHash), "intent not approved");

        // 4) Execute trade via core.
        uint256 beforeOut = IERC20MinimalLike(c.tokenOut).balanceOf(c.vaultAddr);
        ClawCore.ExecutionRequest memory req = ClawCore.ExecutionRequest({
            tokenIn: c.wmon,
            tokenOut: c.tokenOut,
            amountIn: c.amountIn,
            quoteAmountOut: c.quoteAmountOut,
            minAmountOut: c.minAmountOut,
            adapter: c.adapter,
            adapterData: c.adapterData
        });

        uint256 amountOut = core.executeIntent(c.intentHash, req);
        uint256 afterOut = IERC20MinimalLike(c.tokenOut).balanceOf(c.vaultAddr);

        vm.stopBroadcast();

        console2.log("E2E_OK", amountOut);
        console2.log("INTENT_HASH");
        console2.logBytes32(c.intentHash);
        console2.log("VAULT_TOKEN_OUT_DELTA", afterOut - beforeOut);
        console2.log("VAULT_TOKEN_OUT_BALANCE", afterOut);
    }

    function _loadCfg() internal view returns (Cfg memory c) {
        c.deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        c.verifierPk = vm.envUint("VERIFIER_PRIVATE_KEY");
        c.verifier = vm.addr(c.verifierPk);
        c.intentBookAddr = vm.envAddress("INTENT_BOOK_ADDRESS");
        c.coreAddr = vm.envAddress("CORE_ADDRESS");
        c.vaultAddr = vm.envAddress("VAULT_ADDRESS");
        c.wmon = vm.envAddress("NADFUN_WMON_ADDRESS");
        c.tokenOut = vm.envAddress("NADFUN_TARGET_TOKEN");
        c.adapter = vm.envAddress("ADAPTER_ADDRESS");
        c.intentHash = vm.envBytes32("INTENT_HASH");
        c.snapshotHash = vm.envBytes32("SNAPSHOT_HASH");
        c.allowlistHash = vm.envBytes32("ALLOWLIST_HASH");
        c.adapterData = vm.parseBytes(vm.envString("ADAPTER_DATA"));
        c.amountIn = vm.envUint("TRADE_AMOUNT_IN");
        c.quoteAmountOut = vm.envUint("QUOTE_AMOUNT_OUT");
        c.minAmountOut = vm.envUint("MIN_AMOUNT_OUT");
        c.maxSlippageBps = uint16(vm.envUint("MAX_SLIPPAGE_BPS"));
        c.deadline = uint64(vm.envUint("INTENT_DEADLINE"));
        c.sigExpiresAt = uint64(vm.envOr("SIG_EXPIRES_AT", uint256(block.timestamp + 300)));
        c.attestationNonce = vm.envOr("ATTESTATION_NONCE", uint256(1));
    }

    function _domainSeparator(address intentBookAddr) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("ClawIntentBook")),
                keccak256(bytes("1")),
                block.chainid,
                intentBookAddr
            )
        );
    }

    function _intentAttestationDigest(
        address intentBookAddr,
        bytes32 intentHash,
        address verifier,
        uint64 expiresAt,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(INTENT_ATTESTATION_TYPEHASH, intentHash, verifier, expiresAt, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(intentBookAddr), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
