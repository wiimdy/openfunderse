import type { Address } from '@claw/protocol-sdk';

export const NADFUN_TESTNET = {
  chainId: 10143,
  rpcUrl: 'https://monad-testnet.drpc.org',
  curve: '0x1228b0dc9481C11D3071E7A924B794CfB038994e' as Address,
  lens: '0xB056d79CA5257589692699a46623F901a3BB76f1' as Address
} as const;

// MVP fixed allowlist (order matters: targetWeights[i] maps to allowlist[i]).
export const MVP_ALLOWLIST = [
  // ZEN (Zen)
  '0x02300a68a6ca7e65fd0fd95b17108f2ac7867777',
  // tFOMA (FoMA Test Token)
  '0x0b8fe534ab0f6bf6a09e92bb1f260cadd7587777',
  // MONAI (Monad AI)
  '0xdd551bcf21362d182f9426153e80e2c5f6b47777',
  // PFROG (Purple Frog)
  '0x01da4a82d3e29d2fcc174be63d50b9a486e47777',
  // NADOG (NadFun Doge)
  '0x0b038fcf9765a4b14d649d340a809324d6537777',
  // GMON (Giga Monad)
  '0x8bf6bdbf758f55687d7e155d68ae3ed811167777'
].map((v) => v.toLowerCase() as Address) as readonly Address[];

export const DEFAULT_WEIGHT_SCALE = 1_000_000n;

