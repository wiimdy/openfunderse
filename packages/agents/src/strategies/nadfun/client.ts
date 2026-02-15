import { createPublicClient, defineChain, http } from 'viem';
import { NADFUN_TESTNET } from './config.js';

export function createMonadTestnetPublicClient(rpcUrl?: string) {
  const url = rpcUrl && rpcUrl.length > 0 ? rpcUrl : NADFUN_TESTNET.rpcUrl;
  const chain = defineChain({
    id: NADFUN_TESTNET.chainId,
    name: 'monad-testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [url] }, public: { http: [url] } }
  });

  return createPublicClient({
    chain,
    transport: http(url, { timeout: 60_000 })
  });
}

