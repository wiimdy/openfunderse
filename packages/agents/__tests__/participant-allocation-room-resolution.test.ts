import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/skills/participant/index.js', () => ({
  proposeAllocation: vi.fn(async () => ({
    status: 'OK',
    observation: {
      claimHash: '0xclaim',
      canonicalClaim: {
        claimVersion: 'v1',
        fundId: 'fund-x',
        epochId: '8',
        participant: '0x0000000000000000000000000000000000000001',
        targetWeights: ['1', '2'],
        horizonSec: '3600',
        nonce: '1',
        submittedAt: '1'
      },
      participant: '0x0000000000000000000000000000000000000001',
      targetWeights: ['1', '2'],
      horizonSec: '3600',
      nonce: '1',
      submittedAt: '1'
    }
  })),
  validateAllocationOrIntent: vi.fn(async () => ({
    status: 'OK',
    verdict: 'PASS'
  })),
  submitAllocation: vi.fn(async () => ({
    status: 'OK',
    decision: 'READY',
    claimHash: '0xclaim'
  }))
}));

import { runParticipantCli } from '../src/participant-cli.js';
import {
  proposeAllocation,
  submitAllocation,
  validateAllocationOrIntent
} from '../src/skills/participant/index.js';

const mockProposeAllocation = vi.mocked(proposeAllocation);
const mockSubmitAllocation = vi.mocked(submitAllocation);
const mockValidate = vi.mocked(validateAllocationOrIntent);

describe('participant-allocation fund/epoch resolution', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...oldEnv };
  });

  afterEach(() => {
    process.env = oldEnv;
    vi.unstubAllGlobals();
  });

  it('resolves fundId by roomId and epochId as latest+1', async () => {
    process.env.RELAYER_URL = 'http://relayer.local';
    process.env.ROOM_ID = '-1001';
    delete process.env.FUND_ID;
    delete process.env.PARTICIPANT_FUND_ID;

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/v1/rooms/-1001/fund')) {
        return new Response(JSON.stringify({ fundId: 'fund-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('/api/v1/funds/fund-123/epochs/latest')) {
        return new Response(JSON.stringify({ epochState: { epochId: '7' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const ok = await runParticipantCli([
      'participant-allocation',
      '--target-weights',
      '1,2',
      '--no-verify',
      '--no-submit'
    ]);
    expect(ok).toBe(true);

    expect(fetchMock).toHaveBeenCalled();
    expect(mockProposeAllocation).toHaveBeenCalledWith(
      expect.objectContaining({
        fundId: 'fund-123',
        epochId: 8
      })
    );
    expect(mockSubmitAllocation).toHaveBeenCalledWith(
      expect.objectContaining({
        fundId: 'fund-123',
        epochId: 8,
        submit: false,
        disableAutoSubmit: true
      })
    );
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('disables verify when --verify=false is provided', async () => {
    process.env.RELAYER_URL = 'http://relayer.local';
    process.env.ROOM_ID = '-1002';
    delete process.env.FUND_ID;
    delete process.env.PARTICIPANT_FUND_ID;

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/v1/rooms/-1002/fund')) {
        return new Response(JSON.stringify({ fundId: 'fund-456' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('/api/v1/funds/fund-456/epochs/latest')) {
        return new Response(JSON.stringify({ epochState: { epochId: '1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await runParticipantCli([
      'participant-allocation',
      '--target-weights',
      '1,2',
      '--verify=false',
      '--no-submit'
    ]);

    expect(mockValidate).not.toHaveBeenCalled();
  });
});

