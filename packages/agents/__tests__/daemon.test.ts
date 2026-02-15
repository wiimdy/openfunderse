import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest';
import type {
  RelayerEventType,
  SseEvent,
  SseHandlers,
  SseSubscription
} from '../src/lib/relayer-client.js';
import type { DaemonConfig } from '../src/daemon.js';

interface MockState {
  capturedHandlers: SseHandlers<RelayerEventType> | undefined;
  subscribeEvents: Mock;
  getFundStatus: Mock;
  getLatestEpoch: Mock;
  createRelayerClient: Mock;
  handleStrategyEvent: Mock;
  handleParticipantEvent: Mock;
  subscriptionClosers: Mock[];
}

const mockState = vi.hoisted<MockState>(() => {
  const subscribeEvents = vi.fn();
  const getFundStatus = vi.fn();
  const getLatestEpoch = vi.fn();
  const createRelayerClient = vi.fn();
  const handleStrategyEvent = vi.fn();
  const handleParticipantEvent = vi.fn();

  const state: MockState = {
    capturedHandlers: undefined,
    subscribeEvents,
    getFundStatus,
    getLatestEpoch,
    createRelayerClient,
    handleStrategyEvent,
    handleParticipantEvent,
    subscriptionClosers: []
  };

  subscribeEvents.mockImplementation(
    (
      _options: { fundId?: string; types?: RelayerEventType[] },
      handlers: SseHandlers<RelayerEventType>
    ): SseSubscription => {
      state.capturedHandlers = handlers;
      const close = vi.fn();
      state.subscriptionClosers.push(close);
      return { close };
    }
  );

  getFundStatus.mockResolvedValue({});
  getLatestEpoch.mockResolvedValue({});

  createRelayerClient.mockImplementation(() => {
    return {
      subscribeEvents,
      getFundStatus,
      getLatestEpoch
    };
  });

  handleStrategyEvent.mockResolvedValue(undefined);
  handleParticipantEvent.mockResolvedValue(undefined);

  return state;
});

vi.mock('../src/lib/relayer-client.js', () => {
  return {
    createRelayerClient: mockState.createRelayerClient
  };
});

vi.mock('../src/daemon-handlers.js', () => {
  return {
    handleStrategyEvent: mockState.handleStrategyEvent,
    handleParticipantEvent: mockState.handleParticipantEvent
  };
});

import { startDaemon } from '../src/daemon.js';

const baseConfig: DaemonConfig = {
  role: 'strategy',
  fundId: 'fund-1',
  relayerUrl: 'https://relayer.example',
  botId: 'bot-1',
  privateKey: '0xabc',
  botAddress: '0x0000000000000000000000000000000000000001'
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
};

describe('startDaemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockState.capturedHandlers = undefined;
    mockState.subscriptionClosers = [];
    mockState.getFundStatus.mockResolvedValue({});
    mockState.getLatestEpoch.mockResolvedValue({});
    mockState.handleStrategyEvent.mockResolvedValue(undefined);
    mockState.handleParticipantEvent.mockResolvedValue(undefined);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates RelayerClient with correct options', () => {
    const daemon = startDaemon(baseConfig);

    expect(mockState.createRelayerClient).toHaveBeenCalledWith({
      baseUrl: baseConfig.relayerUrl,
      botId: baseConfig.botId,
      privateKey: baseConfig.privateKey,
      botAddress: baseConfig.botAddress
    });

    daemon.stop();
  });

  it('subscribes to strategy events for strategy role', () => {
    const daemon = startDaemon(baseConfig);

    expect(mockState.subscribeEvents).toHaveBeenCalledWith(
      {
        fundId: baseConfig.fundId,
        types: ['epoch:aggregated', 'intent:attested', 'intent:ready']
      },
      expect.objectContaining({
        onOpen: expect.any(Function),
        onEvent: expect.any(Function),
        onError: expect.any(Function)
      })
    );

    daemon.stop();
  });

  it('subscribes to participant events for participant role', () => {
    const daemon = startDaemon({
      ...baseConfig,
      role: 'participant'
    });

    expect(mockState.subscribeEvents).toHaveBeenCalledWith(
      {
        fundId: baseConfig.fundId,
        types: ['epoch:opened', 'epoch:closed']
      },
      expect.objectContaining({
        onOpen: expect.any(Function),
        onEvent: expect.any(Function),
        onError: expect.any(Function)
      })
    );

    daemon.stop();
  });

  it('dispatches events to handleStrategyEvent for strategy role', async () => {
    const daemon = startDaemon(baseConfig);
    const handlers = mockState.capturedHandlers;
    const event: SseEvent<RelayerEventType> = {
      type: 'epoch:aggregated',
      id: '1',
      data: {}
    };

    handlers?.onEvent?.(event);
    await flushMicrotasks();

    expect(mockState.handleStrategyEvent).toHaveBeenCalledWith(event);
    expect(mockState.handleParticipantEvent).not.toHaveBeenCalled();

    daemon.stop();
  });

  it('dispatches events to handleParticipantEvent for participant role', async () => {
    const daemon = startDaemon({
      ...baseConfig,
      role: 'participant'
    });
    const handlers = mockState.capturedHandlers;
    const event: SseEvent<RelayerEventType> = {
      type: 'epoch:opened',
      id: '1',
      data: {}
    };

    handlers?.onEvent?.(event);
    await flushMicrotasks();

    expect(mockState.handleParticipantEvent).toHaveBeenCalledWith(event);
    expect(mockState.handleStrategyEvent).not.toHaveBeenCalled();

    daemon.stop();
  });

  it('resets reconnect delay on successful connect', () => {
    const daemon = startDaemon(baseConfig);
    const firstHandlers = mockState.capturedHandlers;

    firstHandlers?.onError?.(new Error('first disconnect'));
    vi.advanceTimersByTime(1_000);

    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(2);

    const secondHandlers = mockState.capturedHandlers;
    secondHandlers?.onOpen?.();
    secondHandlers?.onError?.(new Error('second disconnect'));

    vi.advanceTimersByTime(999);
    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(3);

    daemon.stop();
  });

  it('reconnects with exponential backoff on error', () => {
    const daemon = startDaemon(baseConfig);
    const firstHandlers = mockState.capturedHandlers;

    firstHandlers?.onError?.(new Error('connection lost #1'));

    vi.advanceTimersByTime(1_000);
    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(2);

    const secondHandlers = mockState.capturedHandlers;
    secondHandlers?.onError?.(new Error('connection lost #2'));

    vi.advanceTimersByTime(1_000);
    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_000);
    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(3);

    daemon.stop();
  });

  it('caps reconnect delay at 30 seconds', () => {
    const daemon = startDaemon(baseConfig);
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    let expectedSubscriptions = 1;

    for (const delay of expectedDelays) {
      const handlers = mockState.capturedHandlers;
      handlers?.onError?.(new Error(`disconnect ${delay}`));

      vi.advanceTimersByTime(delay - 1);
      expect(mockState.subscribeEvents).toHaveBeenCalledTimes(expectedSubscriptions);

      vi.advanceTimersByTime(1);
      expectedSubscriptions += 1;
      expect(mockState.subscribeEvents).toHaveBeenCalledTimes(expectedSubscriptions);
    }

    daemon.stop();
  });

  it('runs reconcile poll on interval', async () => {
    const daemon = startDaemon(baseConfig);

    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(mockState.getFundStatus).toHaveBeenCalledWith(baseConfig.fundId);
    expect(mockState.getLatestEpoch).toHaveBeenCalledWith(baseConfig.fundId);

    daemon.stop();
  });

  it('stop() cleans up subscription and timers', async () => {
    const daemon = startDaemon({
      ...baseConfig,
      pollIntervalMs: 1_000
    });

    daemon.stop();

    expect(mockState.subscriptionClosers[0]).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    await flushMicrotasks();

    expect(mockState.getFundStatus).not.toHaveBeenCalled();
    expect(mockState.getLatestEpoch).not.toHaveBeenCalled();
  });

  it('does not reconnect after stop()', () => {
    const daemon = startDaemon(baseConfig);
    const handlers = mockState.capturedHandlers;

    daemon.stop();
    handlers?.onError?.(new Error('disconnect after stop'));
    vi.advanceTimersByTime(60_000);

    expect(mockState.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it('logs handler errors without crashing', async () => {
    mockState.handleStrategyEvent.mockRejectedValueOnce(new Error('handler boom'));
    const daemon = startDaemon(baseConfig);
    const handlers = mockState.capturedHandlers;

    handlers?.onEvent?.({ type: 'epoch:aggregated', id: '1', data: {} });
    await flushMicrotasks();

    expect(console.error).toHaveBeenCalledWith(
      '[daemon] handler error',
      expect.any(Error)
    );

    daemon.stop();
  });

  it('logs reconcile poll errors without crashing', async () => {
    mockState.getFundStatus.mockRejectedValueOnce(new Error('poll boom'));
    const daemon = startDaemon(baseConfig);

    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(console.error).toHaveBeenCalledWith(
      '[daemon] reconcile error',
      expect.any(Error)
    );

    daemon.stop();
  });

  it('handles stop() called twice gracefully', () => {
    const daemon = startDaemon(baseConfig);
    daemon.stop();
    daemon.stop();

    expect(mockState.subscriptionClosers[0]).toHaveBeenCalledTimes(1);
  });
});
