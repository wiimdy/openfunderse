import { createPublicClient, http } from "viem";
import {
  encodeNadfunExecutionDataV1,
  intentExecutionCallHash,
  intentHash
} from "../dist/index.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function withDefault(name, fallback) {
  return process.env[name] || fallback;
}

async function main() {
  const rpcUrl = requireEnv("RPC_URL");
  const chainId = Number(process.env.CHAIN_ID || "10143");
  const coreAddress = requireEnv("CORE_ADDRESS");
  const vaultAddress = requireEnv("VAULT_ADDRESS");
  const adapterAddress = requireEnv("ADAPTER_ADDRESS");
  const tokenIn = withDefault("NADFUN_WMON_ADDRESS", "0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd");
  const tokenOut = requireEnv("NADFUN_TARGET_TOKEN");
  const snapshotHash = requireEnv("SNAPSHOT_HASH");

  const bondingRouter = withDefault(
    "NADFUN_BONDING_CURVE_ROUTER",
    "0x865054F0F6A288adaAc30261731361EA7E908003"
  );
  const dexRouter = withDefault(
    "NADFUN_DEX_ROUTER",
    "0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2"
  );
  const lens = withDefault(
    "NADFUN_LENS_ADDRESS",
    "0xB056d79CA5257589692699a46623F901a3BB76f1"
  );

  const amountIn = BigInt(requireEnv("TRADE_AMOUNT_IN"));
  const maxSlippageBps = BigInt(process.env.MAX_SLIPPAGE_BPS || "300");
  const ttl = Number(process.env.INTENT_TTL_SECONDS || "600");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttl);

  const publicClient = createPublicClient({
    chain: {
      id: chainId,
      name: "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    },
    transport: http(rpcUrl)
  });

  const [router, quoteAmountOut] = await publicClient.readContract({
    address: lens,
    abi: [
      {
        type: "function",
        name: "getAmountOut",
        stateMutability: "view",
        inputs: [
          { name: "_token", type: "address" },
          { name: "_amountIn", type: "uint256" },
          { name: "_isBuy", type: "bool" }
        ],
        outputs: [
          { name: "router", type: "address" },
          { name: "amountOut", type: "uint256" }
        ]
      }
    ],
    functionName: "getAmountOut",
    args: [tokenOut, amountIn, true]
  });

  const routerLc = router.toLowerCase();
  let venue = "NADFUN_BONDING_CURVE";
  if (routerLc === dexRouter.toLowerCase()) {
    venue = "NADFUN_DEX";
  } else if (routerLc !== bondingRouter.toLowerCase()) {
    throw new Error(`lens returned unsupported router: ${router}`);
  }

  const minAmountOut = (quoteAmountOut * (10_000n - maxSlippageBps)) / 10_000n;

  const adapterData = encodeNadfunExecutionDataV1({
    version: 1,
    action: "BUY",
    venue,
    router,
    recipient: vaultAddress,
    token: tokenOut,
    deadline,
    amountOutMin: minAmountOut,
    extra: "0x"
  });

  const allowlistHash = intentExecutionCallHash(
    tokenIn,
    tokenOut,
    quoteAmountOut,
    minAmountOut,
    adapterAddress,
    adapterData
  );

  const intent = intentHash({
    intentVersion: "v1",
    vault: coreAddress,
    action: "BUY",
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    deadline,
    maxSlippageBps,
    snapshotHash
  });

  // Export shell lines for orchestration scripts.
  console.log(`export NADFUN_ROUTER=${router}`);
  console.log(`export QUOTE_AMOUNT_OUT=${quoteAmountOut.toString()}`);
  console.log(`export MIN_AMOUNT_OUT=${minAmountOut.toString()}`);
  console.log(`export INTENT_DEADLINE=${deadline.toString()}`);
  console.log(`export ADAPTER_DATA=${adapterData}`);
  console.log(`export ALLOWLIST_HASH=${allowlistHash}`);
  console.log(`export INTENT_HASH=${intent}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

