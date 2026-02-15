import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpochStateRecord } from "@claw/protocol-sdk";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getEpochStateByEpoch,
  getFundDeployment,
  listAllocationClaimsByEpoch,
  listStakeWeightsByFund,
  upsertEpochState,
  type AllocationClaimRow,
  type EpochStateRow,
  type FundDeploymentRow
} from "@/lib/supabase";
import { AggregateError, aggregateEpoch } from "@/lib/epoch-aggregator";

vi.mock("@claw/protocol-sdk", () => ({
  buildEpochStateRecord: vi.fn(),
  parseAbi: vi.fn()
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  defineChain: vi.fn((config: unknown) => config),
  http: vi.fn(),
  parseAbi: vi.fn()
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn()
}));

vi.mock("@/lib/supabase", () => ({
  getEpochStateByEpoch: vi.fn(),
  getFundDeployment: vi.fn(),
  listAllocationClaimsByEpoch: vi.fn(),
  listStakeWeightsByFund: vi.fn(),
  upsertEpochState: vi.fn()
}));

const mockBuildEpochStateRecord = vi.mocked(buildEpochStateRecord);
const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockCreateWalletClient = vi.mocked(createWalletClient);
const mockDefineChain = vi.mocked(defineChain);
const mockHttp = vi.mocked(http);
const mockPrivateKeyToAccount = vi.mocked(privateKeyToAccount);

const mockGetEpochStateByEpoch = vi.mocked(getEpochStateByEpoch);
const mockGetFundDeployment = vi.mocked(getFundDeployment);
const mockListAllocationClaimsByEpoch = vi.mocked(listAllocationClaimsByEpoch);
const mockListStakeWeightsByFund = vi.mocked(listStakeWeightsByFund);
const mockUpsertEpochState = vi.mocked(upsertEpochState);

const mockGetCode = vi.fn();
const mockReadContract = vi.fn();
const mockSimulateContract = vi.fn();
const mockWriteContract = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();

const FUND_ID = "fund-1";
const EPOCH_ID = BigInt(1);
const PARTICIPANT_A = `0x${"11".repeat(20)}`;
const PARTICIPANT_B = `0x${"22".repeat(20)}`;
const PARTICIPANT_C = `0x${"33".repeat(20)}`;
const SNAPSHOT_BOOK_ADDRESS = `0x${"aa".repeat(20)}`;
const EPOCH_STATE_HASH = `0x${"12".repeat(32)}`;
const TX_HASH = `0x${"34".repeat(32)}`;

const SNAPSHOT_PUBLISHER_KEY = `0x${"ab".repeat(32)}`;
const RELAYER_SIGNER_KEY = `0x${"cd".repeat(32)}`;
const EXECUTOR_KEY = `0x${"ef".repeat(32)}`;

function makeClaim(participant: string, weights: number[], epochId = "1", createdAt = 1000): AllocationClaimRow {
  return {
    id: Math.random(),
    fund_id: FUND_ID,
    claim_hash: `0x${participant.slice(2)}claim`,
    epoch_id: epochId,
    participant,
    claim_json: JSON.stringify({ targetWeights: weights }),
    created_by: "bot-1",
    created_at: createdAt,
    updated_at: createdAt
  };
}

const makeFundDeployment = (overrides?: Partial<FundDeploymentRow>): FundDeploymentRow => ({
  id: 1,
  fund_id: FUND_ID,
  chain_id: "10143",
  factory_address: `0x${"10".repeat(20)}`,
  onchain_fund_id: "1",
  intent_book_address: `0x${"20".repeat(20)}`,
  claw_core_address: `0x${"30".repeat(20)}`,
  claw_vault_address: `0x${"40".repeat(20)}`,
  fund_owner_address: `0x${"50".repeat(20)}`,
  strategy_agent_address: `0x${"60".repeat(20)}`,
  snapshot_book_address: SNAPSHOT_BOOK_ADDRESS,
  asset_address: `0x${"70".repeat(20)}`,
  deploy_tx_hash: `0x${"80".repeat(32)}`,
  deploy_block_number: "123",
  deployer_address: `0x${"90".repeat(20)}`,
  created_at: 1700000000000,
  updated_at: 1700000000000,
  ...overrides
});

const makeEpochState = (overrides?: Partial<EpochStateRow>): EpochStateRow => ({
  id: 1,
  fund_id: FUND_ID,
  epoch_id: EPOCH_ID.toString(),
  epoch_state_hash: "0xexisting",
  aggregate_weights_json: "[]",
  claim_hashes_json: "[]",
  claim_count: 0,
  finalized_at: 1700000000000,
  created_at: 1700000000000,
  updated_at: 1700000000000,
  ...overrides
});

const VALID_BYTECODE = "0x6080604052";

const setPublishSuccess = (): void => {
  mockGetCode.mockReset();
  mockReadContract.mockReset();
  mockSimulateContract.mockReset();
  mockWriteContract.mockReset();
  mockWaitForTransactionReceipt.mockReset();

  mockGetCode.mockResolvedValue(VALID_BYTECODE);
  mockReadContract
    .mockResolvedValueOnce(false)   // validator: isSnapshotFinalized(bytes32(0))
    .mockResolvedValueOnce(false)   // aggregator: isSnapshotFinalized(epochStateHash) → not published
    .mockResolvedValueOnce(true);   // aggregator: post-publish read-back
  mockSimulateContract.mockResolvedValue({ request: { to: SNAPSHOT_BOOK_ADDRESS } });
  mockWriteContract.mockResolvedValue(TX_HASH);
  mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
};

const expectAggregateError = async (
  promise: Promise<unknown>,
  code: AggregateError["code"],
  message: string
): Promise<AggregateError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) {
      throw error;
    }
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    return error;
  }

  throw new Error("expected aggregateEpoch to throw");
};

describe("aggregateEpoch", () => {
  beforeEach(() => {
    process.env.CHAIN_ID = "10143";
    process.env.RPC_URL = "https://rpc.example.com";
    process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY = SNAPSHOT_PUBLISHER_KEY;

    mockListAllocationClaimsByEpoch.mockResolvedValue([makeClaim(PARTICIPANT_A, [10000, 0])]);
    mockListStakeWeightsByFund.mockResolvedValue([{ participant: PARTICIPANT_A.toLowerCase(), weight: BigInt(1) }]);
    mockGetFundDeployment.mockResolvedValue(makeFundDeployment());
    mockGetEpochStateByEpoch.mockResolvedValue(undefined);
    mockUpsertEpochState.mockResolvedValue(undefined);

    mockBuildEpochStateRecord.mockReturnValue(
      {
        epochStateHash: EPOCH_STATE_HASH
      } as unknown as ReturnType<typeof buildEpochStateRecord>
    );

    mockCreatePublicClient.mockReturnValue(
      {
        getCode: mockGetCode,
        readContract: mockReadContract,
        simulateContract: mockSimulateContract,
        waitForTransactionReceipt: mockWaitForTransactionReceipt
      } as unknown as ReturnType<typeof createPublicClient>
    );

    mockCreateWalletClient.mockReturnValue(
      {
        writeContract: mockWriteContract
      } as unknown as ReturnType<typeof createWalletClient>
    );

    mockPrivateKeyToAccount.mockReturnValue(
      {
        address: PARTICIPANT_A
      } as unknown as ReturnType<typeof privateKeyToAccount>
    );

    mockDefineChain.mockImplementation((config: unknown) => config as ReturnType<typeof defineChain>);
    mockHttp.mockReturnValue({} as unknown as ReturnType<typeof http>);

    setPublishSuccess();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CHAIN_ID;
    delete process.env.RPC_URL;
    delete process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY;
    delete process.env.RELAYER_SIGNER_PRIVATE_KEY;
    delete process.env.EXECUTOR_PRIVATE_KEY;
  });

  describe("validation errors (BAD_REQUEST)", () => {
    it("throws when no claims exist for epoch", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "no allocation claims for epoch"
      );
    });

    it("throws when claim_json is invalid JSON", async () => {
      const claim = { ...makeClaim(PARTICIPANT_A, [10000, 0]), claim_json: "not json" };
      mockListAllocationClaimsByEpoch.mockResolvedValue([claim]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        `invalid claim_json in claim ${claim.claim_hash}`
      );
    });

    it("throws when targetWeights is missing", async () => {
      const claim = { ...makeClaim(PARTICIPANT_A, [10000, 0]), claim_json: "{}" };
      mockListAllocationClaimsByEpoch.mockResolvedValue([claim]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        `invalid targetWeights in claim ${claim.claim_hash}`
      );
    });

    it("throws when targetWeights is empty array", async () => {
      const claim = {
        ...makeClaim(PARTICIPANT_A, [10000, 0]),
        claim_json: JSON.stringify({ targetWeights: [] })
      };
      mockListAllocationClaimsByEpoch.mockResolvedValue([claim]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        `invalid targetWeights in claim ${claim.claim_hash}`
      );
    });

    it("throws when targetWeights contains non-numeric value", async () => {
      const claim = {
        ...makeClaim(PARTICIPANT_A, [10000, 0]),
        claim_json: JSON.stringify({ targetWeights: ["abc"] })
      };
      mockListAllocationClaimsByEpoch.mockResolvedValue([claim]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "targetWeights must contain only integer values"
      );
    });

    it("throws when targetWeights dimensions mismatch", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([
        makeClaim(PARTICIPANT_A, [7000, 3000]),
        makeClaim(PARTICIPANT_B, [10000])
      ]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "targetWeights dimension mismatch"
      );
    });

    it("throws when targetWeights sum is zero", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([makeClaim(PARTICIPANT_A, [0, 0])]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "targetWeights sum must be positive"
      );
    });

    it("throws when targetWeights sum mismatch across participants", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([
        makeClaim(PARTICIPANT_A, [7000, 3000]),
        makeClaim(PARTICIPANT_B, [6000, 3000])
      ]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "targetWeights sum mismatch across participants"
      );
    });

    it("throws when fund has no deployment", async () => {
      mockGetFundDeployment.mockResolvedValue(undefined);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "fund is not deployed yet (missing onchain deployment metadata)"
      );
    });

    it("throws when snapshot_book_address is invalid", async () => {
      mockGetFundDeployment.mockResolvedValue(
        makeFundDeployment({ snapshot_book_address: "not-an-address" })
      );

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "invalid snapshotBook address in deployment"
      );

      expect(error.details).toEqual({ snapshotBookAddress: "not-an-address" });
    });

    it("throws when total stake is non-positive", async () => {
      mockListStakeWeightsByFund.mockResolvedValue([{ participant: PARTICIPANT_A.toLowerCase(), weight: BigInt(0) }]);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "BAD_REQUEST",
        "total stake must be positive"
      );
    });
  });

  describe("config errors (CONFIG_ERROR)", () => {
    it("throws when CHAIN_ID is missing", async () => {
      delete process.env.CHAIN_ID;

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "CONFIG_ERROR",
        "CHAIN_ID must be a positive number"
      );
    });

    it("throws when CHAIN_ID is not a positive number", async () => {
      process.env.CHAIN_ID = "abc";

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "CONFIG_ERROR",
        "CHAIN_ID must be a positive number"
      );
    });

    it("throws when RPC_URL is missing", async () => {
      delete process.env.RPC_URL;

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "CONFIG_ERROR",
        "RPC_URL is required"
      );
    });

    it("throws when signer key is missing", async () => {
      delete process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY;
      delete process.env.RELAYER_SIGNER_PRIVATE_KEY;
      delete process.env.EXECUTOR_PRIVATE_KEY;

      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract.mockResolvedValue(false);

      await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "CONFIG_ERROR",
        "missing required key to publish snapshot (set SNAPSHOT_PUBLISHER_PRIVATE_KEY or RELAYER_SIGNER_PRIVATE_KEY or EXECUTOR_PRIVATE_KEY)"
      );
    });
  });

  describe("on-chain errors (ONCHAIN_ERROR)", () => {
    it("throws validation error when readContract (isSnapshotFinalized) reverts", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract.mockRejectedValueOnce(new Error("read failed"));

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        `snapshotBook at ${SNAPSHOT_BOOK_ADDRESS} does not implement SnapshotBook interface`
      );

      expect(error.details?.validation).toEqual({
        hasCode: true,
        isSnapshotFinalizedCallable: false,
        errors: expect.arrayContaining([expect.stringContaining("read failed")])
      });
    });

    it("throws when aggregator readContract fails after validation passes", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("read failed"));

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        "failed to read snapshot finalization status"
      );

      expect(error.details).toEqual({ cause: "read failed" });
    });

    it("throws when publishSnapshot simulation fails", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      mockSimulateContract.mockReset();
      mockSimulateContract.mockRejectedValueOnce(new Error("simulation failed"));

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        "failed to publish snapshot onchain"
      );

      expect(error.details).toEqual({ txHash: null, cause: "simulation failed" });
    });

    it("throws when transaction receipt shows reverted", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      mockSimulateContract.mockReset();
      mockSimulateContract.mockResolvedValueOnce({ request: { to: SNAPSHOT_BOOK_ADDRESS } });
      mockWriteContract.mockReset();
      mockWriteContract.mockResolvedValueOnce(TX_HASH);
      mockWaitForTransactionReceipt.mockReset();
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        `publishSnapshot reverted: ${TX_HASH}`
      );

      expect(error.details).toEqual({ txHash: TX_HASH });
    });

    it("throws when post-publish finalization check fails", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      mockSimulateContract.mockReset();
      mockSimulateContract.mockResolvedValueOnce({ request: { to: SNAPSHOT_BOOK_ADDRESS } });
      mockWriteContract.mockReset();
      mockWriteContract.mockResolvedValueOnce(TX_HASH);
      mockWaitForTransactionReceipt.mockReset();
      mockWaitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        "snapshot root publish succeeded but read-back check failed"
      );

      expect(error.details).toEqual({ txHash: TX_HASH });
    });

    it("wraps non-AggregateError from publish flow", async () => {
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      mockSimulateContract.mockReset();
      mockSimulateContract.mockResolvedValueOnce({ request: { to: SNAPSHOT_BOOK_ADDRESS } });
      mockWriteContract.mockReset();
      mockWriteContract.mockRejectedValueOnce("wallet exploded");

      const error = await expectAggregateError(
        aggregateEpoch(FUND_ID, EPOCH_ID),
        "ONCHAIN_ERROR",
        "failed to publish snapshot onchain"
      );

      expect(error.details).toEqual({ txHash: null, cause: "wallet exploded" });
    });
  });

  describe("success paths", () => {
    it("returns ALREADY_AGGREGATED when snapshot already published and epoch state exists", async () => {
      const existing = makeEpochState({ epoch_state_hash: "0xexisting-state" });
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockGetEpochStateByEpoch.mockResolvedValue(existing);

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result).toEqual({
        status: "ALREADY_AGGREGATED",
        epochStateHash: "0xexisting-state",
        snapshotBookAddress: SNAPSHOT_BOOK_ADDRESS,
        snapshotPublish: { alreadyPublished: true, txHash: null },
        claimScale: "10000",
        participantCount: 1,
        claimCount: 1,
        aggregateWeights: ["10000", "0"]
      });
      expect(mockCreateWalletClient).not.toHaveBeenCalled();
      expect(mockUpsertEpochState).not.toHaveBeenCalled();
    });

    it("happy path: single participant, publishes snapshot, returns OK", async () => {
      setPublishSuccess();

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result).toEqual({
        status: "OK",
        epochStateHash: EPOCH_STATE_HASH,
        snapshotBookAddress: SNAPSHOT_BOOK_ADDRESS,
        snapshotPublish: {
          alreadyPublished: false,
          txHash: TX_HASH
        },
        claimScale: "10000",
        participantCount: 1,
        claimCount: 1,
        aggregateWeights: ["10000", "0"]
      });
      expect(mockGetCode).toHaveBeenCalledTimes(1);
      expect(mockReadContract).toHaveBeenCalledTimes(3);
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
      expect(mockWriteContract).toHaveBeenCalledTimes(1);
      expect(mockWaitForTransactionReceipt).toHaveBeenCalledTimes(1);
    });

    it("happy path: multiple participants with stake-weighted aggregation", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([
        makeClaim(PARTICIPANT_A, [7000, 3000]),
        makeClaim(PARTICIPANT_B, [5000, 5000])
      ]);
      mockListStakeWeightsByFund.mockResolvedValue([
        { participant: PARTICIPANT_A.toLowerCase(), weight: BigInt(3) },
        { participant: PARTICIPANT_B.toLowerCase(), weight: BigInt(1) }
      ]);
      setPublishSuccess();

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result.claimScale).toBe("10000");
      expect(result.aggregateWeights).toEqual(["6500", "3500"]);
      expect(result.participantCount).toBe(2);
      expect(result.claimCount).toBe(2);
    });

    it("uses latest claim when participant has multiple claims", async () => {
      const latestClaim = makeClaim(PARTICIPANT_A, [6000, 4000], "1", 2000);
      const olderClaim = makeClaim(PARTICIPANT_A, [9000, 1000], "1", 1000);
      mockListAllocationClaimsByEpoch.mockResolvedValue([latestClaim, olderClaim]);
      setPublishSuccess();

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result.participantCount).toBe(1);
      expect(result.claimCount).toBe(1);
      expect(result.aggregateWeights).toEqual(["6000", "4000"]);
      expect(mockBuildEpochStateRecord).toHaveBeenCalledWith({
        epochId: EPOCH_ID,
        claimHashes: [latestClaim.claim_hash]
      });
    });

    it("defaults to stake=1 when no stake row for participant", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([
        makeClaim(PARTICIPANT_A, [8000, 2000]),
        makeClaim(PARTICIPANT_B, [6000, 4000])
      ]);
      mockListStakeWeightsByFund.mockResolvedValue([]);
      setPublishSuccess();

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result.aggregateWeights).toEqual(["7000", "3000"]);
    });

    it("distributes remainder to first weight element", async () => {
      mockListAllocationClaimsByEpoch.mockResolvedValue([
        makeClaim(PARTICIPANT_A, [3333, 6667]),
        makeClaim(PARTICIPANT_B, [3333, 6667]),
        makeClaim(PARTICIPANT_C, [3334, 6666])
      ]);
      mockListStakeWeightsByFund.mockResolvedValue([]);
      setPublishSuccess();

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(result.aggregateWeights).toEqual(["3334", "6666"]);
    });

    it("calls upsertEpochState with correct args", async () => {
      const claimB = makeClaim(PARTICIPANT_B, [5000, 5000]);
      const claimA = makeClaim(PARTICIPANT_A, [7000, 3000]);
      mockListAllocationClaimsByEpoch.mockResolvedValue([claimB, claimA]);
      mockListStakeWeightsByFund.mockResolvedValue([
        { participant: PARTICIPANT_A.toLowerCase(), weight: BigInt(3) },
        { participant: PARTICIPANT_B.toLowerCase(), weight: BigInt(1) }
      ]);
      mockGetCode.mockResolvedValue(VALID_BYTECODE);
      mockReadContract.mockReset();
      mockReadContract
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockGetEpochStateByEpoch.mockResolvedValue(undefined);

      const result = await aggregateEpoch(FUND_ID, EPOCH_ID);

      const sortedClaimHashes = [claimA.claim_hash, claimB.claim_hash].sort((a, b) =>
        a.localeCompare(b)
      );

      expect(result.status).toBe("OK");
      expect(result.snapshotPublish).toEqual({ alreadyPublished: true, txHash: null });
      expect(mockUpsertEpochState).toHaveBeenCalledWith({
        fundId: FUND_ID,
        epochId: EPOCH_ID,
        epochStateHash: EPOCH_STATE_HASH,
        aggregateWeightsJson: JSON.stringify(["6500", "3500"]),
        claimHashes: sortedClaimHashes
      });
    });
  });

  describe("signer key fallback", () => {
    it("uses RELAYER_SIGNER_PRIVATE_KEY when SNAPSHOT_PUBLISHER_PRIVATE_KEY is absent", async () => {
      delete process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY;
      process.env.RELAYER_SIGNER_PRIVATE_KEY = RELAYER_SIGNER_KEY;
      setPublishSuccess();

      await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(mockPrivateKeyToAccount).toHaveBeenCalledWith(RELAYER_SIGNER_KEY);
    });

    it("uses EXECUTOR_PRIVATE_KEY as last fallback", async () => {
      delete process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY;
      delete process.env.RELAYER_SIGNER_PRIVATE_KEY;
      process.env.EXECUTOR_PRIVATE_KEY = EXECUTOR_KEY;
      setPublishSuccess();

      await aggregateEpoch(FUND_ID, EPOCH_ID);

      expect(mockPrivateKeyToAccount).toHaveBeenCalledWith(EXECUTOR_KEY);
    });
  });
});
