import { beforeEach, describe, expect, it, vi } from "vitest";
import { tickAllFunds, tickEpoch } from "@/lib/epoch-manager";
import {
  closeEpoch,
  extendEpoch,
  getActiveEpoch,
  getLatestEpochState,
  listActionableFunds,
  markEpochAggregated,
  openEpoch,
  type EpochLifecycleRow,
  type EpochStateRow
} from "@/lib/supabase";
import { aggregateEpoch } from "@/lib/epoch-aggregator";
import { publishEvent } from "@/lib/event-publisher";

vi.mock("@/lib/supabase", () => ({
  openEpoch: vi.fn(),
  getActiveEpoch: vi.fn(),
  closeEpoch: vi.fn(),
  markEpochAggregated: vi.fn(),
  extendEpoch: vi.fn(),
  getLatestEpochState: vi.fn(),
  listActionableFunds: vi.fn()
}));

vi.mock("@/lib/epoch-aggregator", () => ({
  aggregateEpoch: vi.fn()
}));

vi.mock("@/lib/event-publisher", () => ({
  publishEvent: vi.fn()
}));

const mockOpenEpoch = vi.mocked(openEpoch);
const mockGetActiveEpoch = vi.mocked(getActiveEpoch);
const mockCloseEpoch = vi.mocked(closeEpoch);
const mockMarkEpochAggregated = vi.mocked(markEpochAggregated);
const mockExtendEpoch = vi.mocked(extendEpoch);
const mockGetLatestEpochState = vi.mocked(getLatestEpochState);
const mockListActionableFunds = vi.mocked(listActionableFunds);
const mockAggregateEpoch = vi.mocked(aggregateEpoch);
const mockPublishEvent = vi.mocked(publishEvent);

const FIXED_NOW = 1700000000000;

const createEpoch = (overrides?: Partial<EpochLifecycleRow>): EpochLifecycleRow => ({
  id: 1,
  fund_id: "fund-1",
  epoch_id: "7",
  status: "OPEN",
  opened_at: FIXED_NOW - 60_000,
  closes_at: FIXED_NOW + 60_000,
  closed_at: null,
  claim_count: 0,
  created_at: FIXED_NOW - 60_000,
  updated_at: FIXED_NOW - 60_000,
  ...overrides
});

const createEpochState = (overrides?: Partial<EpochStateRow>): EpochStateRow => ({
  id: 9,
  fund_id: "fund-1",
  epoch_id: "3",
  epoch_state_hash: "0xstate",
  aggregate_weights_json: "[]",
  claim_hashes_json: "[]",
  claim_count: 0,
  finalized_at: FIXED_NOW - 1,
  created_at: FIXED_NOW - 1,
  updated_at: FIXED_NOW - 1,
  ...overrides
});

const aggregateResult = {
  status: "OK" as const,
  epochStateHash: "0xabc",
  snapshotBookAddress: "0x0000000000000000000000000000000000000001",
  snapshotPublish: {
    alreadyPublished: false,
    txHash: "0xdeadbeef"
  },
  claimScale: "10000",
  participantCount: 3,
  claimCount: 5,
  aggregateWeights: ["7000", "3000"]
};

describe("tickEpoch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a new epoch when no active epoch exists", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockResolvedValue(createEpoch({ epoch_id: "1" }));
    mockPublishEvent.mockResolvedValue({} as never);

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 30_000,
      epochMinClaims: 2,
      epochMaxClaims: 10,
      nowMs: FIXED_NOW
    });

    expect(mockOpenEpoch).toHaveBeenCalledWith({
      fundId: "fund-1",
      epochId: "1",
      closesAt: FIXED_NOW + 30_000
    });
    expect(mockPublishEvent).toHaveBeenCalledWith("epoch:opened", "fund-1", {
      epochId: "1",
      closesAt: FIXED_NOW + 30_000
    });
    expect(result).toEqual({ action: "OPENED", fundId: "fund-1", epochId: "1" });
  });

  it("opens next epoch based on latest epoch state", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(createEpochState({ epoch_id: "3" }));
    mockOpenEpoch.mockResolvedValue(createEpoch({ epoch_id: "4" }));
    mockPublishEvent.mockResolvedValue({} as never);

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 1_000,
      epochMinClaims: 1,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(mockOpenEpoch).toHaveBeenCalledWith({
      fundId: "fund-1",
      epochId: "4",
      closesAt: FIXED_NOW + 1_000
    });
    expect(result).toEqual({ action: "OPENED", fundId: "fund-1", epochId: "4" });
  });

  it("returns SKIPPED on concurrent open (duplicate error)", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 10_000,
      epochMinClaims: 1,
      epochMaxClaims: 2,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({
      action: "SKIPPED",
      fundId: "fund-1",
      reason: "concurrent open detected"
    });
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("returns SKIPPED on concurrent open (23505 error code in message)", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockRejectedValue(new Error("postgres error 23505"));

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 10_000,
      epochMinClaims: 1,
      epochMaxClaims: 2,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({
      action: "SKIPPED",
      fundId: "fund-1",
      reason: "concurrent open detected"
    });
  });

  it("returns SKIPPED on concurrent open (unique keyword)", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockRejectedValue(new Error("UNIQUE constraint failed"));

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 10_000,
      epochMinClaims: 1,
      epochMaxClaims: 2,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({
      action: "SKIPPED",
      fundId: "fund-1",
      reason: "concurrent open detected"
    });
  });

  it("re-throws non-duplicate openEpoch errors", async () => {
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockRejectedValue(new Error("database unavailable"));

    await expect(
      tickEpoch({
        fundId: "fund-1",
        epochDurationMs: 10_000,
        epochMinClaims: 1,
        epochMaxClaims: 2,
        nowMs: FIXED_NOW
      })
    ).rejects.toThrow("database unavailable");
  });

  it("returns NOOP when epoch is still active (not expired, not max claims)", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW + 5_000, claim_count: 4, epoch_id: "8" })
    );

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 20_000,
      epochMinClaims: 2,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({ action: "NOOP", fundId: "fund-1", reason: "epoch still active" });
  });

  it("closes and aggregates when time expired and min claims met", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW - 1, claim_count: 3, epoch_id: "10" })
    );
    mockAggregateEpoch.mockResolvedValue(aggregateResult);
    mockPublishEvent.mockResolvedValue({} as never);

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 60_000,
      epochMinClaims: 2,
      epochMaxClaims: 10,
      nowMs: FIXED_NOW
    });

    expect(mockCloseEpoch).toHaveBeenCalledWith({ fundId: "fund-1", epochId: "10" });
    expect(mockAggregateEpoch).toHaveBeenCalledWith("fund-1", BigInt("10"));
    expect(mockMarkEpochAggregated).toHaveBeenCalledWith({ fundId: "fund-1", epochId: "10" });
    expect(mockPublishEvent).toHaveBeenCalledWith("epoch:aggregated", "fund-1", {
      epochId: "10",
      epochStateHash: "0xabc",
      aggregateWeights: ["7000", "3000"],
      claimCount: 5,
      participantCount: 3
    });
    expect(result).toEqual({
      action: "AGGREGATED",
      fundId: "fund-1",
      epochId: "10",
      epochStateHash: "0xabc"
    });
  });

  it("closes and aggregates when max claims reached", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW + 10_000, claim_count: 6, epoch_id: "11" })
    );
    mockAggregateEpoch.mockResolvedValue(aggregateResult);
    mockPublishEvent.mockResolvedValue({} as never);

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 60_000,
      epochMinClaims: 3,
      epochMaxClaims: 6,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({
      action: "AGGREGATED",
      fundId: "fund-1",
      epochId: "11",
      epochStateHash: "0xabc"
    });
  });

  it("extends epoch when time expired but min claims NOT met", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW - 1, claim_count: 1, epoch_id: "12" })
    );

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 15_000,
      epochMinClaims: 2,
      epochMaxClaims: 6,
      nowMs: FIXED_NOW
    });

    expect(mockExtendEpoch).toHaveBeenCalledWith({
      fundId: "fund-1",
      epochId: "12",
      newClosesAt: FIXED_NOW + 15_000
    });
    expect(result).toEqual({
      action: "EXTENDED",
      fundId: "fund-1",
      epochId: "12",
      newClosesAt: FIXED_NOW + 15_000
    });
  });

  it("returns NOOP when max claims not reached and min claims not met and time not expired", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW + 1000, claim_count: 1, epoch_id: "13" })
    );

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 10_000,
      epochMinClaims: 2,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({ action: "NOOP", fundId: "fund-1", reason: "epoch still active" });
  });

  it("returns NOOP waiting minimum claims when max reached before minimum", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW + 2_000, claim_count: 5, epoch_id: "14" })
    );

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 30_000,
      epochMinClaims: 6,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({
      action: "NOOP",
      fundId: "fund-1",
      reason: "waiting for minimum claims"
    });
  });

  it("returns ERROR when aggregateEpoch throws", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW - 1, claim_count: 4, epoch_id: "15" })
    );
    mockAggregateEpoch.mockRejectedValue(new Error("aggregation failed"));

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 30_000,
      epochMinClaims: 2,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({ action: "ERROR", fundId: "fund-1", error: "aggregation failed" });
  });

  it("returns ERROR with stringified message for non-Error failures", async () => {
    mockGetActiveEpoch.mockResolvedValue(
      createEpoch({ closes_at: FIXED_NOW - 1, claim_count: 4, epoch_id: "16" })
    );
    mockCloseEpoch.mockRejectedValue("close failed");

    const result = await tickEpoch({
      fundId: "fund-1",
      epochDurationMs: 30_000,
      epochMinClaims: 2,
      epochMaxClaims: 5,
      nowMs: FIXED_NOW
    });

    expect(result).toEqual({ action: "ERROR", fundId: "fund-1", error: "close failed" });
  });
});

describe("tickAllFunds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes all actionable funds sequentially", async () => {
    mockListActionableFunds.mockResolvedValue([
      {
        fundId: "fund-a",
        epochDurationMs: 10_000,
        epochMinClaims: 1,
        epochMaxClaims: 5,
        activeEpoch: null
      },
      {
        fundId: "fund-b",
        epochDurationMs: 20_000,
        epochMinClaims: 2,
        epochMaxClaims: 6,
        activeEpoch: null
      }
    ]);
    mockGetActiveEpoch.mockResolvedValue(undefined);
    mockGetLatestEpochState.mockResolvedValue(undefined);
    mockOpenEpoch.mockResolvedValue(createEpoch({ epoch_id: "1" }));
    mockPublishEvent.mockResolvedValue({} as never);

    const results = await tickAllFunds({ nowMs: FIXED_NOW, limit: 2 });

    expect(results).toEqual([
      { action: "OPENED", fundId: "fund-a", epochId: "1" },
      { action: "OPENED", fundId: "fund-b", epochId: "1" }
    ]);
    expect(mockGetActiveEpoch.mock.calls).toEqual([["fund-a"], ["fund-b"]]);
    expect(mockOpenEpoch.mock.calls.map(([arg]) => arg.fundId)).toEqual(["fund-a", "fund-b"]);
  });

  it("returns empty array when no actionable funds", async () => {
    mockListActionableFunds.mockResolvedValue([]);

    const results = await tickAllFunds({ nowMs: FIXED_NOW });

    expect(results).toEqual([]);
    expect(mockGetActiveEpoch).not.toHaveBeenCalled();
  });

  it("passes limit parameter to listActionableFunds", async () => {
    mockListActionableFunds.mockResolvedValue([]);

    await tickAllFunds({ nowMs: FIXED_NOW, limit: 7 });

    expect(mockListActionableFunds).toHaveBeenCalledWith({ nowMs: FIXED_NOW, limit: 7 });
  });
});
