import type { RelayerEventType, SseEvent } from './lib/relayer-client.js';

export const handleStrategyEvent = async (
  event: SseEvent<RelayerEventType>
): Promise<void> => {
  switch (event.type) {
    case 'epoch:aggregated': {
      const data = event.data as {
        fundId: string;
        epochId: string;
        epochStateHash: string;
      };
      console.log(
        `[strategy] epoch aggregated - fund=${data.fundId} epoch=${data.epochId} hash=${data.epochStateHash}`
      );
      console.log('[strategy] TODO: auto-propose intent based on aggregate weights');
      break;
    }
    case 'intent:attested': {
      const data = event.data as {
        fundId: string;
        intentHash: string;
        attestedWeight: string;
        thresholdWeight: string;
      };
      console.log(
        `[strategy] intent attested - fund=${data.fundId} intent=${data.intentHash} weight=${data.attestedWeight}/${data.thresholdWeight}`
      );
      break;
    }
    case 'intent:ready': {
      const data = event.data as { fundId: string; intentHash: string };
      console.log(
        `[strategy] intent ready for onchain - fund=${data.fundId} intent=${data.intentHash}`
      );
      console.log('[strategy] TODO: auto-submit onchain attestation + execution');
      break;
    }
    default:
      console.log(`[strategy] unhandled event: ${event.type}`);
  }
};

export const handleParticipantEvent = async (
  event: SseEvent<RelayerEventType>
): Promise<void> => {
  switch (event.type) {
    case 'epoch:opened': {
      const data = event.data as {
        fundId: string;
        epochId: string;
        closesAt: number;
      };
      console.log(
        `[participant] new epoch opened - fund=${data.fundId} epoch=${data.epochId} closes=${new Date(data.closesAt).toISOString()}`
      );
      console.log('[participant] TODO: auto-submit allocation claim');
      break;
    }
    case 'epoch:closed': {
      const data = event.data as {
        fundId: string;
        epochId: string;
        claimCount: number;
      };
      console.log(
        `[participant] epoch closed - fund=${data.fundId} epoch=${data.epochId} claims=${data.claimCount}`
      );
      break;
    }
    default:
      console.log(`[participant] unhandled event: ${event.type}`);
  }
};
