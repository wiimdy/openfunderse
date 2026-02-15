/**
 * E2E Integration Test: Full Epoch Lifecycle with 6-token Claims
 *
 * Tests the complete event pipeline:
 *   epoch:opened → claims submitted → epoch closed → aggregated → epoch:aggregated
 *
 * Uses REAL event-emitter + event-publisher wiring, mocks only DB and on-chain boundaries.
 *
 * Tokens under test (Monad testnet allowlist):
 *   [0] ZEN   0x02300a68a6ca7e65fd0fd95b17108f2ac7867777
 *   [1] tFOMA 0x0b8fe534ab0f6bf6a09e92bb1f260cadd7587777
 *   [2] MONAI 0xdd551bcf21362d182f9426153e80e2c5f6b47777
 *   [3] PFROG 0x01da4a82d3e29d2fcc174be63d50b9a486e47777
 *   [4] NADOG 0x0b038fcf9765a4b14d649d340a809324d6537777
 *   [5] GMON  0x8bf6bdbf758f55687d7e155d68ae3ed811167777
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/event-emitter";

// ─── Token Config ────────────────────────────────────────────────────────────
const TOKENS = [
  { symbol: "ZEN",   address: "0x02300a68a6ca7e65fd0fd95b17108f2ac7867777" },
  { symbol: "tFOMA", address: "0x0b8fe534ab0f6bf6a09e92bb1f260cadd7587777" },
  { symbol: "MONAI", address: "0xdd551bcf21362d182f9426153e80e2c5f6b47777" },
  { symbol: "PFROG", address: "0x01da4a82d3e29d2fcc174be63d50b9a486e47777" },
  { symbol: "NADOG", address: "0x0b038fcf9765a4b14d649d340a809324d6537777" },
  { symbol: "GMON",  address: "0x8bf6bdbf758f55687d7e155d68ae3ed811167777" },
] as const;

const FUND_ID = "fund-monad-e2e-001";
const EPOCH_DURATION_MS = 60_000;
const EPOCH_MIN_CLAIMS = 2;
const EPOCH_MAX_CLAIMS = 10;

// ─── Claim Fixtures (3 participants, 6-token weights summing to 10000) ───────
const CLAIMS = [
  {
    participant: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    // Bullish ZEN + MONAI
    targetWeights: ["3500", "1000", "2500", "1000", "1000", "1000"],
  },
  {
    participant: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    // Balanced spread
    targetWeights: ["1500", "2000", "1500", "2000", "1500", "1500"],
  },
  {
    participant: "0xcccccccccccccccccccccccccccccccccccccccc",
    // Heavy GMON bet
    targetWeights: ["500", "500", "500", "500", "500", "7500"],
  },
];

const STAKE_WEIGHTS = [
  {
    participant: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    weight: BigInt(100),
  },
  {
    participant: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    weight: BigInt(200),
  },
  {
    participant: "0xcccccccccccccccccccccccccccccccccccccccc",
    weight: BigInt(300),
  },
] as const;

// ─── DB State (in-memory simulation) ─────────────────────────────────────────
let dbEpochs: Map<string, {
  epoch_id: string;
  status: "OPEN" | "CLOSED" | "AGGREGATED";
  closes_at: number;
  claim_count: number;
  opened_at: number;
}>;
let dbClaims: Array<{
  id: number;
  fund_id: string;
  claim_hash: string;
  epoch_id: string;
  participant: string;
  claim_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}>;
let dbEpochStates: Map<string, {
  epoch_id: string;
  epoch_state_hash: string;
  aggregate_weights_json: string;
}>;
let dbOutboxEvents: Array<{
  id: number;
  event_type: string;
  fund_id: string;
  payload: Record<string, unknown>;
  created_at: number;
}>;
let outboxIdCounter: number;
let claimIdCounter: number;

// ─── Mock Supabase ───────────────────────────────────────────────────────────
vi.mock("@/lib/supabase", () => ({
  openEpoch: vi.fn(async ({ fundId, epochId, closesAt }: { fundId: string; epochId: string; closesAt: number }) => {
    dbEpochs.set(`${fundId}:${epochId}`, {
      epoch_id: epochId,
      status: "OPEN",
      closes_at: closesAt,
      claim_count: 0,
      opened_at: Date.now(),
    });
  }),
  getActiveEpoch: vi.fn(async (fundId: string) => {
    const activeEntry = Array.from(dbEpochs.entries()).find(([key, epoch]) => {
      return key.startsWith(`${fundId}:`) && epoch.status === "OPEN";
    });

    if (activeEntry) {
      const [, epoch] = activeEntry;
      return { ...epoch, fund_id: fundId, id: 1, closed_at: null, created_at: 0, updated_at: 0 };
    }

    return null;
  }),
  closeEpoch: vi.fn(async ({ fundId, epochId }: { fundId: string; epochId: string }) => {
    const key = `${fundId}:${epochId}`;
    const epoch = dbEpochs.get(key);
    if (epoch) epoch.status = "CLOSED";
  }),
  markEpochAggregated: vi.fn(async ({ fundId, epochId }: { fundId: string; epochId: string }) => {
    const key = `${fundId}:${epochId}`;
    const epoch = dbEpochs.get(key);
    if (epoch) epoch.status = "AGGREGATED";
  }),
  extendEpoch: vi.fn(),
  getLatestEpochState: vi.fn(async () => null),
  listActionableFunds: vi.fn(async () => [{
    fundId: FUND_ID,
    epochDurationMs: EPOCH_DURATION_MS,
    epochMinClaims: EPOCH_MIN_CLAIMS,
    epochMaxClaims: EPOCH_MAX_CLAIMS,
  }]),
  incrementEpochClaimCount: vi.fn(async ({ fundId, epochId }: { fundId: string; epochId: string }) => {
    const key = `${fundId}:${epochId}`;
    const epoch = dbEpochs.get(key);
    if (epoch) epoch.claim_count += 1;
  }),
  insertOutboxEvent: vi.fn(async ({ eventType, fundId, payload }: {
    eventType: string;
    fundId: string;
    payload: Record<string, unknown>;
  }) => {
    outboxIdCounter += 1;
    const row = {
      id: outboxIdCounter,
      event_type: eventType,
      fund_id: fundId,
      payload,
      created_at: Date.now(),
    };
    dbOutboxEvents.push(row);
    return row;
  }),
  // Used by aggregateEpoch
  listAllocationClaimsByEpoch: vi.fn(async ({ fundId, epochId }: { fundId: string; epochId: bigint }) => {
    return dbClaims.filter(
      (c) => c.fund_id === fundId && c.epoch_id === String(epochId)
    );
  }),
  listStakeWeightsByFund: vi.fn(async (fundId: string) => {
    if (fundId !== FUND_ID) {
      return [];
    }

    return STAKE_WEIGHTS.map((row) => ({
      participant: row.participant,
      weight: row.weight,
    }));
  }),
  getFundDeployment: vi.fn(async () => ({
    id: 1,
    fund_id: FUND_ID,
    chain_id: "10143",
    factory_address: "0x" + "ff".repeat(20),
    onchain_fund_id: "1",
    intent_book_address: "0x" + "11".repeat(20),
    claw_core_address: "0x" + "22".repeat(20),
    claw_vault_address: "0x" + "33".repeat(20),
    fund_owner_address: "0x" + "44".repeat(20),
    strategy_agent_address: "0x" + "55".repeat(20),
    snapshot_book_address: "0x" + "aa".repeat(20),
    asset_address: "0x" + "66".repeat(20),
    deploy_tx_hash: "0x" + "77".repeat(32),
    deploy_block_number: "100",
    deployer_address: "0x" + "88".repeat(20),
    created_at: 0,
    updated_at: 0,
  })),
  getEpochStateByEpoch: vi.fn(async () => null),
  upsertEpochState: vi.fn(async ({ fundId, epochId, epochStateHash, aggregateWeightsJson }: {
    fundId: string;
    epochId: bigint;
    epochStateHash: string;
    aggregateWeightsJson: string;
    claimHashes: string[];
  }) => {
    dbEpochStates.set(`${fundId}:${epochId}`, {
      epoch_id: String(epochId),
      epoch_state_hash: epochStateHash,
      aggregate_weights_json: aggregateWeightsJson,
    });
  }),
}));

// Mock on-chain calls (viem)
const mockReadContract = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      simulateContract: vi.fn(async () => ({ request: {} })),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: vi.fn(async () => "0x" + "ee".repeat(32)),
    })),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0x" + "99".repeat(20),
  })),
}));

// Mock buildEpochStateRecord — return deterministic hash
vi.mock("@claw/protocol-sdk", async () => {
  const actual = await vi.importActual<typeof import("@claw/protocol-sdk")>("@claw/protocol-sdk");
  return {
    ...actual,
    buildEpochStateRecord: vi.fn(({ epochId }: { epochId: bigint }) => ({
      epochStateHash: `0xepochstate_${epochId}`,
    })),
  };
});

// ─── Import REAL modules (they use real event-emitter internally) ────────────
import { relayerEvents } from "@/lib/event-emitter";
import { tickEpoch, tickAllFunds } from "@/lib/epoch-manager";

describe("E2E: Epoch Lifecycle → Claims → Aggregate → Events", () => {
  const collectedEvents: SseEvent[] = [];
  let eventListener: (event: SseEvent) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset in-memory DB
    dbEpochs = new Map();
    dbClaims = [];
    dbEpochStates = new Map();
    dbOutboxEvents = [];
    outboxIdCounter = 0;
    claimIdCounter = 0;

    // Env vars for aggregator
    process.env.CHAIN_ID = "10143";
    process.env.RPC_URL = "https://rpc.monad.example";
    process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY = "0x" + "ab".repeat(32);

    // First readContract call (isSnapshotFinalized) → false (not yet published)
    // Second readContract call (post-publish check) → true
    mockReadContract
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    // Collect SSE events from real event-emitter
    collectedEvents.length = 0;
    eventListener = (event: SseEvent) => {
      collectedEvents.push(event);
    };
    relayerEvents.on("event", eventListener);
  });

  afterEach(() => {
    relayerEvents.off("event", eventListener);
    delete process.env.CHAIN_ID;
    delete process.env.RPC_URL;
    delete process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY;
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function addClaim(
    participant: string,
    targetWeights: string[],
    epochId: string
  ) {
    claimIdCounter += 1;
    const claimHash = `0xclaim${claimIdCounter.toString().padStart(4, "0")}`;
    dbClaims.push({
      id: claimIdCounter,
      fund_id: FUND_ID,
      claim_hash: claimHash,
      epoch_id: epochId,
      participant,
      claim_json: JSON.stringify({
        claimVersion: "v1",
        fundId: FUND_ID,
        epochId,
        participant,
        targetWeights,
        horizonSec: "3600",
        nonce: String(claimIdCounter),
        submittedAt: String(Math.floor(Date.now() / 1000)),
      }),
      created_by: `bot-${participant.slice(2, 6)}`,
      created_at: Date.now() + claimIdCounter,
      updated_at: Date.now() + claimIdCounter,
    });

    const epoch = dbEpochs.get(`${FUND_ID}:${epochId}`);
    if (epoch) {
      epoch.claim_count += 1;
    }

    return claimHash;
  }

  // ─── Test: Full Pipeline ─────────────────────────────────────────────────
  it("full pipeline: open epoch → submit 3 claims (6 tokens) → close → aggregate → verify events + weights", async () => {
    const NOW = 1_700_000_000_000;

    // ── Step 1: Open epoch via tickEpoch ──
    const openResult = await tickEpoch({
      fundId: FUND_ID,
      epochDurationMs: EPOCH_DURATION_MS,
      epochMinClaims: EPOCH_MIN_CLAIMS,
      epochMaxClaims: EPOCH_MAX_CLAIMS,
      nowMs: NOW,
    });

    expect(openResult).toMatchObject({
      action: "OPENED",
      fundId: FUND_ID,
      epochId: "1",
    });

    // Verify epoch:opened event was emitted
    const openedEvent = collectedEvents.find((e) => e.type === "epoch:opened");
    expect(openedEvent).toBeDefined();
    expect((openedEvent!.data as Record<string, unknown>).fundId).toBe(FUND_ID);
    expect((openedEvent!.data as Record<string, unknown>).epochId).toBe("1");
    expect((openedEvent!.data as Record<string, unknown>).closesAt).toBe(NOW + EPOCH_DURATION_MS);

    // Verify outbox was written
    expect(dbOutboxEvents).toHaveLength(1);
    expect(dbOutboxEvents[0].event_type).toBe("epoch:opened");

    console.log("✅ Step 1: Epoch opened, epoch:opened event emitted");

    // ── Step 2: Submit 3 claims with 6-token weights ──
    for (const claim of CLAIMS) {
      const hash = addClaim(claim.participant, claim.targetWeights, "1");
      console.log(
        `   📋 Claim ${hash} from ${claim.participant.slice(0, 10)}... weights=[${claim.targetWeights.join(",")}]`
      );
    }

    // Verify DB state
    expect(dbClaims).toHaveLength(3);
    console.log("✅ Step 2: 3 claims submitted to epoch 1");

    // ── Step 3: Tick while epoch still active → should NOOP ──
    const noopResult = await tickEpoch({
      fundId: FUND_ID,
      epochDurationMs: EPOCH_DURATION_MS,
      epochMinClaims: EPOCH_MIN_CLAIMS,
      epochMaxClaims: EPOCH_MAX_CLAIMS,
      nowMs: NOW + 30_000, // 30s into 60s epoch
    });

    expect(noopResult.action).toBe("NOOP");
    console.log("✅ Step 3: Mid-epoch tick returns NOOP (as expected)");

    // ── Step 4: Advance time past epoch close → should aggregate ──
    const aggregateResult = await tickEpoch({
      fundId: FUND_ID,
      epochDurationMs: EPOCH_DURATION_MS,
      epochMinClaims: EPOCH_MIN_CLAIMS,
      epochMaxClaims: EPOCH_MAX_CLAIMS,
      nowMs: NOW + EPOCH_DURATION_MS + 1_000, // 1s past close
    });

    expect(aggregateResult).toMatchObject({
      action: "AGGREGATED",
      fundId: FUND_ID,
      epochId: "1",
    });

    // Verify epoch state in DB
    const epochState = dbEpochStates.get(`${FUND_ID}:1`);
    expect(epochState).toBeDefined();
    expect(epochState!.epoch_state_hash).toBe("0xepochstate_1");

    console.log("✅ Step 4: Epoch closed + aggregated");

    // ── Step 5: Verify epoch:aggregated event ──
    const aggEvent = collectedEvents.find((e) => e.type === "epoch:aggregated");
    expect(aggEvent).toBeDefined();

    const aggData = aggEvent!.data as Record<string, unknown>;
    expect(aggData.fundId).toBe(FUND_ID);
    expect(aggData.epochId).toBe("1");
    expect(aggData.epochStateHash).toBe("0xepochstate_1");
    expect(aggData.participantCount).toBe(3);
    expect(aggData.claimCount).toBe(3);

    console.log("✅ Step 5: epoch:aggregated event emitted with correct data");

    // ── Step 6: Verify aggregate weight math ──
    //
    // Stake rows are explicitly mocked for all participants:
    //   A stake = 100
    //   B stake = 200
    //   C stake = 300
    // Total stake = 600
    //
    // Token weights by participant (all sum to 10000):
    //   A: [3500, 1000, 2500, 1000, 1000, 1000]  (bullish ZEN + MONAI)
    //   B: [1500, 2000, 1500, 2000, 1500, 1500]  (balanced)
    //   C: [ 500,  500,  500,  500,  500, 7500]  (heavy GMON)
    //
    // Aggregate[i] = (A[i]*100 + B[i]*200 + C[i]*300) / 600
    //   [0] ZEN:   (3500*100 + 1500*200 +  500*300) / 600 =  800000/600 = 1333
    //   [1] tFOMA: (1000*100 + 2000*200 +  500*300) / 600 =  650000/600 = 1083
    //   [2] MONAI: (2500*100 + 1500*200 +  500*300) / 600 =  700000/600 = 1166
    //   [3] PFROG: (1000*100 + 2000*200 +  500*300) / 600 =  650000/600 = 1083
    //   [4] NADOG: (1000*100 + 1500*200 +  500*300) / 600 =  550000/600 =  916
    //   [5] GMON:  (1000*100 + 1500*200 + 7500*300) / 600 = 2650000/600 = 4416
    //
    // Sum before remainder: 1333+1083+1166+1083+916+4416 = 9997
    // Remainder: 10000 - 9997 = 3 → added to [0]
    // Final: [1336, 1083, 1166, 1083, 916, 4416]
    //
    const expectedWeights = ["1336", "1083", "1166", "1083", "916", "4416"];
    const actualWeights = aggData.aggregateWeights as string[];

    console.log("\n   📊 Aggregate Weights (stake-weighted, 3 participants):");
    for (let i = 0; i < TOKENS.length; i++) {
      const pct = ((Number(actualWeights[i]) / 10000) * 100).toFixed(1);
      console.log(
        `      ${TOKENS[i].symbol.padEnd(6)} ${TOKENS[i].address}  →  ${actualWeights[i].padStart(5)} / 10000  (${pct}%)`
      );
    }

    expect(actualWeights).toEqual(expectedWeights);
    console.log("\n✅ Step 6: Aggregate weights verified — math correct");

    // ── Step 7: Verify all SSE events in order ──
    const eventTypes = collectedEvents.map((e) => e.type);
    expect(eventTypes).toEqual(["epoch:opened", "epoch:aggregated"]);
    console.log("✅ Step 7: Event sequence correct: epoch:opened → epoch:aggregated");

    // ── Step 8: Verify outbox persistence for replay ──
    expect(dbOutboxEvents).toHaveLength(2);
    expect(dbOutboxEvents[0].event_type).toBe("epoch:opened");
    expect(dbOutboxEvents[1].event_type).toBe("epoch:aggregated");
    console.log("✅ Step 8: Both events persisted in outbox for SSE replay");

    // ── Step 9: Verify epoch status progression in DB ──
    const epoch = dbEpochs.get(`${FUND_ID}:1`);
    expect(epoch!.status).toBe("AGGREGATED");
    console.log("✅ Step 9: Epoch status: OPEN → CLOSED → AGGREGATED\n");

    // ── Summary ──
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  E2E RESULT: Full epoch lifecycle completed successfully");
    console.log("  Pipeline: epoch:opened → 3 claims (6 tokens) → epoch:aggregated");
    console.log(`  Aggregate weights ready for strategy intent proposal`);
    console.log("═══════════════════════════════════════════════════════════");
  });

  it("tickAllFunds processes the fund and fires events end-to-end", async () => {
    const NOW = 1_700_000_000_000;

    // First tick: opens epoch
    const results1 = await tickAllFunds({ nowMs: NOW });
    expect(results1).toHaveLength(1);
    expect(results1[0].action).toBe("OPENED");
    expect(collectedEvents.filter((e) => e.type === "epoch:opened")).toHaveLength(1);

    // Submit claims
    for (const claim of CLAIMS) {
      addClaim(claim.participant, claim.targetWeights, "1");
    }

    // Reset readContract mocks for the aggregate call
    mockReadContract
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    // Second tick after expiry: aggregates
    const results2 = await tickAllFunds({ nowMs: NOW + EPOCH_DURATION_MS + 1_000 });
    expect(results2).toHaveLength(1);
    expect(results2[0].action).toBe("AGGREGATED");
    expect(collectedEvents.filter((e) => e.type === "epoch:aggregated")).toHaveLength(1);

    console.log("✅ tickAllFunds E2E: open → aggregate via cron-like ticks");
  });

  it("epoch extends when min claims not met", async () => {
    const NOW = 1_700_000_000_000;

    // Open epoch
    await tickEpoch({
      fundId: FUND_ID,
      epochDurationMs: EPOCH_DURATION_MS,
      epochMinClaims: EPOCH_MIN_CLAIMS,
      epochMaxClaims: EPOCH_MAX_CLAIMS,
      nowMs: NOW,
    });

    // Submit only 1 claim (min is 2)
    addClaim(CLAIMS[0].participant, CLAIMS[0].targetWeights, "1");
    const epoch = dbEpochs.get(`${FUND_ID}:1`)!;
    epoch.claim_count = 1;

    // Tick after expiry with insufficient claims → should extend
    const extendResult = await tickEpoch({
      fundId: FUND_ID,
      epochDurationMs: EPOCH_DURATION_MS,
      epochMinClaims: EPOCH_MIN_CLAIMS,
      epochMaxClaims: EPOCH_MAX_CLAIMS,
      nowMs: NOW + EPOCH_DURATION_MS + 1_000,
    });

    expect(extendResult.action).toBe("EXTENDED");
    expect(extendResult).toMatchObject({
      action: "EXTENDED",
      fundId: FUND_ID,
      epochId: "1",
    });

    // epoch:opened was emitted but NO epoch:aggregated
    const eventTypes = collectedEvents.map((e) => e.type);
    expect(eventTypes).toEqual(["epoch:opened"]);

    console.log("✅ Epoch extended — min claims not met, no premature aggregation");
  });

  it("verifies claim format matches the expected JSON structure", () => {
    // Verify the claim JSON format matches what the user specified
    addClaim(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ["3500", "1000", "2500", "1000", "1000", "1000"],
      "1"
    );

    const claim = JSON.parse(dbClaims[0].claim_json);
    expect(claim).toMatchObject({
      claimVersion: "v1",
      fundId: FUND_ID,
      epochId: "1",
      participant: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetWeights: ["3500", "1000", "2500", "1000", "1000", "1000"],
      horizonSec: "3600",
    });

    // Verify it has exactly 6 weights (one per token)
    expect(claim.targetWeights).toHaveLength(TOKENS.length);

    console.log("✅ Claim JSON format matches spec:");
    console.log(JSON.stringify(claim, null, 2));
  });
});
