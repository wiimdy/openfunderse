import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleParticipantEvent,
  handleStrategyEvent
} from '../src/daemon-handlers.js';
import type { RelayerEventType, SseEvent } from '../src/lib/relayer-client.js';

describe('handleStrategyEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles epoch:aggregated event without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'epoch:aggregated',
      id: '1',
      data: { fundId: 'f1', epochId: '5', epochStateHash: '0xabc' }
    };

    await expect(handleStrategyEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[strategy]'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('epoch aggregated')
    );
    logSpy.mockRestore();
  });

  it('handles intent:attested event without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'intent:attested',
      id: '2',
      data: {
        fundId: 'f1',
        intentHash: '0xdef',
        attestedWeight: '10',
        thresholdWeight: '20'
      }
    };

    await expect(handleStrategyEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[strategy]'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('intent attested')
    );
    logSpy.mockRestore();
  });

  it('handles intent:ready event without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'intent:ready',
      id: '3',
      data: { fundId: 'f1', intentHash: '0x123' }
    };

    await expect(handleStrategyEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[strategy]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('intent ready'));
    logSpy.mockRestore();
  });

  it('handles unknown event type without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'unknown:event' as RelayerEventType,
      id: '4',
      data: {}
    };

    await expect(handleStrategyEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[strategy]'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('unhandled event: unknown:event')
    );
    logSpy.mockRestore();
  });
});

describe('handleParticipantEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles epoch:opened event without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'epoch:opened',
      id: '1',
      data: { fundId: 'f1', epochId: '1', closesAt: 1700000000 }
    };

    await expect(handleParticipantEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[participant]')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('new epoch opened')
    );
    logSpy.mockRestore();
  });

  it('handles epoch:closed event without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'epoch:closed',
      id: '2',
      data: { fundId: 'f1', epochId: '1', claimCount: 3 }
    };

    await expect(handleParticipantEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[participant]')
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('epoch closed'));
    logSpy.mockRestore();
  });

  it('handles unknown event type without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event: SseEvent<RelayerEventType> = {
      type: 'unknown:event' as RelayerEventType,
      id: '3',
      data: {}
    };

    await expect(handleParticipantEvent(event)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[participant]')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('unhandled event: unknown:event')
    );
    logSpy.mockRestore();
  });
});
