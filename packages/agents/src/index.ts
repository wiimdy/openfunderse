import { runRedditMvpCli } from './reddit-mvp.js';

export { createRelayerClient, RelayerClient } from './lib/relayer-client.js';
export type {
  ClaimAttestationInput,
  ClaimQuery,
  ClaimTemplateInput,
  IntentAttestationInput,
  RelayerProposeIntentInput,
  RelayerClientOptions,
  RelayerHttpErrorShape,
  SseEvent,
  SseHandlers,
  SseSubscription
} from './lib/relayer-client.js';

export { createBotSigner, BotSigner } from './lib/signer.js';
export type {
  BotSignerOptions,
  SignedClaimAttestation,
  SignedIntentAttestation
} from './lib/signer.js';

export {
  attestClaim,
  mineClaim,
  submitMinedClaim,
  verifyClaim
} from './skills/participant/index.js';
export type {
  AttestClaimInput,
  AttestClaimOutput,
  MineClaimInput,
  MineClaimOutput,
  MineClaimObservation,
  SubmitMinedClaimInput,
  SubmitMinedClaimOutput,
  VerifyClaimInput,
  VerifyClaimOutput
} from './skills/participant/index.js';

export { proposeIntent } from './skills/strategy/index.js';
export type {
  ProposeIntentInput,
  ProposeIntentOutput,
  ProposeDecision,
  HoldDecision,
  RiskChecks
} from './skills/strategy/index.js';

console.log('[agents] boot');
console.log(`[agents] strategy key set=${Boolean(process.env.STRATEGY_PRIVATE_KEY)}`);
console.log(`[agents] verifier key set=${Boolean(process.env.VERIFIER_PRIVATE_KEY)}`);
console.log(`[agents] crawler key set=${Boolean(process.env.CRAWLER_PRIVATE_KEY)}`);

runRedditMvpCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agents] error: ${message}`);
  process.exitCode = 1;
});
