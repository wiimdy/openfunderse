import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "@claw/protocol-sdk";
import { loadRuntimeConfig } from "@/lib/config";

const INTENT_BOOK_ABI = parseAbi([
  "function attestIntent(bytes32 intentHash, address[] verifiers, bytes[] sigs)"
]);

function clients() {
  const cfg = loadRuntimeConfig();
  if (!cfg.signerKey) {
    throw new Error("missing required env: RELAYER_SIGNER_PRIVATE_KEY");
  }

  const chain = defineChain({
    id: Number(cfg.chainId),
    name: `claw-${cfg.chainId.toString(10)}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
      public: { http: [cfg.rpcUrl] }
    }
  });

  const account = privateKeyToAccount(cfg.signerKey);

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  return { cfg, account, publicClient, walletClient };
}

async function submitWithRetry(input: {
  subjectHash: Hex;
  verifiers: `0x${string}`[];
  signatures: Hex[];
}): Promise<Hex> {
  const { cfg, account, publicClient, walletClient } = clients();

  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.maxSubmitRetries; attempt += 1) {
    try {
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending"
      });

      let hash: Hex;

      hash = await walletClient.writeContract({
        address: cfg.intentBookAddress,
        abi: INTENT_BOOK_ABI,
        functionName: "attestIntent",
        args: [input.subjectHash, input.verifiers, input.signatures],
        nonce,
        account
      });

      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  throw lastError;
}

export async function submitIntentAttestationsOnchain(input: {
  intentHash: Hex;
  verifiers: `0x${string}`[];
  signatures: Hex[];
}): Promise<Hex> {
  return submitWithRetry({
    subjectHash: input.intentHash,
    verifiers: input.verifiers,
    signatures: input.signatures
  });
}
