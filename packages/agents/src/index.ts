import { runRedditMvpCli } from './reddit-mvp.js';
import { runParticipantCli } from './participant-cli.js';
import { runStrategyCli } from './strategy-cli.js';
import { runClawbotCli } from './clawbot-cli.js';

export { createRelayerClient, RelayerClient } from './lib/relayer-client.js';
export type {
  ClaimAttestationInput,
  ClaimQuery,
  ClaimTemplateInput,
  IntentAttestationInput,
  IntentOnchainBundleItem,
  IntentOnchainBundleResponse,
  ReadyExecutionPayloadItem,
  RelayerProposeIntentInput,
  RelayerClientOptions,
  RelayerHttpErrorShape,
  SyncFundDeploymentInput,
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

export { proposeIntent, proposeIntentAndSubmit } from './skills/strategy/index.js';
export type {
  ProposeIntentAndSubmitInput,
  ProposeIntentAndSubmitOutput,
  ProposeIntentInput,
  ProposeIntentOutput,
  ProposeDecision,
  HoldDecision,
  RiskChecks
} from './skills/strategy/index.js';

console.log('[agents] boot');
console.log(
  `[agents] strategy key set=${Boolean(
    process.env.STRATEGY_PRIVATE_KEY
  )}`
);
console.log(
  `[agents] participant key set=${Boolean(
    process.env.PARTICIPANT_PRIVATE_KEY ||
      process.env.BOT_PRIVATE_KEY ||
      process.env.VERIFIER_PRIVATE_KEY
  )}`
);

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const handledByClawbot = await runClawbotCli(argv);
  if (handledByClawbot) {
    return;
  }
  const handledByStrategy = await runStrategyCli(argv);
  if (handledByStrategy) {
    return;
  }
  const handledByParticipant = await runParticipantCli(argv);
  if (!handledByParticipant) {
    await runRedditMvpCli(argv);
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agents] error: ${message}`);
  process.exitCode = 1;
});
