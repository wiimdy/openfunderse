import {
  createRelayerClient,
  type Address,
  type Hex,
  type RelayerEventType,
  type SseEvent,
  type SseSubscription
} from './lib/relayer-client.js';
import { handleParticipantEvent, handleStrategyEvent } from './daemon-handlers.js';

export interface DaemonConfig {
  role: 'strategy' | 'participant';
  fundId: string;
  relayerUrl: string;
  botId: string;
  privateKey: string;
  botAddress?: string;
  pollIntervalMs?: number;
}

const STRATEGY_EVENT_TYPES: RelayerEventType[] = [
  'epoch:aggregated',
  'intent:attested',
  'intent:ready'
];

const PARTICIPANT_EVENT_TYPES: RelayerEventType[] = ['epoch:opened', 'epoch:closed'];

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export const startDaemon = (config: DaemonConfig): { stop: () => void } => {
  const client = createRelayerClient({
    baseUrl: config.relayerUrl,
    botId: config.botId,
    privateKey: config.privateKey as Hex,
    botAddress: config.botAddress as Address | undefined
  });

  const types =
    config.role === 'strategy' ? STRATEGY_EVENT_TYPES : PARTICIPANT_EVENT_TYPES;
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let stopped = false;
  let reconnectDelayMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let subscription: SseSubscription | undefined;

  const runHandler = async (event: SseEvent<RelayerEventType>): Promise<void> => {
    if (config.role === 'strategy') {
      await handleStrategyEvent(event);
      return;
    }
    await handleParticipantEvent(event);
  };

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };

  const closeSubscription = (): void => {
    if (!subscription) return;
    subscription.close();
    subscription = undefined;
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    clearReconnectTimer();
    const waitMs = reconnectDelayMs;
    console.log(`[daemon] reconnecting in ${waitMs}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, waitMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_BACKOFF_MS);
  };

  const connect = (): void => {
    if (stopped) return;
    closeSubscription();
    subscription = client.subscribeEvents(
      {
        fundId: config.fundId,
        types
      },
      {
        onOpen: () => {
          reconnectDelayMs = INITIAL_BACKOFF_MS;
          console.log('[daemon] connected');
        },
        onEvent: (event) => {
          console.log(`[daemon] event: ${event.type}`);
          void runHandler(event).catch((error: unknown) => {
            console.error('[daemon] handler error', error);
          });
        },
        onError: (error: unknown) => {
          if (stopped) return;
          console.error('[daemon] stream error', error);
          closeSubscription();
          scheduleReconnect();
        }
      }
    );
  };

  const runReconcilePoll = async (): Promise<void> => {
    if (stopped) return;
    console.log('[daemon] reconcile poll');
    try {
      await Promise.all([
        client.getFundStatus(config.fundId),
        client.getLatestEpoch(config.fundId)
      ]);
    } catch (error) {
      console.error('[daemon] reconcile error', error);
    }
  };

  pollTimer = setInterval(() => {
    void runReconcilePoll();
  }, pollIntervalMs);

  connect();

  return {
    stop: () => {
      stopped = true;
      clearReconnectTimer();
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      closeSubscription();
    }
  };
};
