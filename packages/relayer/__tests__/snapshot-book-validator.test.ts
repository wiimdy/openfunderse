import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateSnapshotBookInterface,
  isSnapshotBookValid,
  type SnapshotBookValidation
} from "@/lib/snapshot-book-validator";
import type { Address, PublicClient } from "viem";

const VALID_ADDRESS = `0x${"aa".repeat(20)}` as Address;
const VALID_BYTECODE = "0x6080604052" as `0x${string}`;

function makeClient(overrides: {
  getCode?: () => Promise<`0x${string}` | undefined>;
  readContract?: () => Promise<unknown>;
}): PublicClient {
  return {
    getCode: overrides.getCode ?? (async () => VALID_BYTECODE),
    readContract: overrides.readContract ?? (async () => false)
  } as unknown as PublicClient;
}

describe("validateSnapshotBookInterface", () => {
  describe("bytecode check", () => {
    it("fails when address has no bytecode (EOA)", async () => {
      const client = makeClient({ getCode: async () => "0x" });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(false);
      expect(result.isSnapshotFinalizedCallable).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("no deployed bytecode");
    });

    it("fails when address has undefined bytecode", async () => {
      const client = makeClient({ getCode: async () => undefined as unknown as `0x${string}` });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("no deployed bytecode");
    });

    it("fails when eth_getCode throws", async () => {
      const client = makeClient({
        getCode: async () => { throw new Error("RPC unreachable"); }
      });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("eth_getCode");
      expect(result.errors[0]).toContain("RPC unreachable");
    });

    it("short-circuits: does not call readContract when no bytecode", async () => {
      const readContract = vi.fn();
      const client = makeClient({
        getCode: async () => "0x",
        readContract
      });

      await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(readContract).not.toHaveBeenCalled();
    });
  });

  describe("isSnapshotFinalized callable", () => {
    it("passes when isSnapshotFinalized returns false", async () => {
      const client = makeClient({ readContract: async () => false });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(true);
      expect(result.isSnapshotFinalizedCallable).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("passes when isSnapshotFinalized returns true", async () => {
      const client = makeClient({ readContract: async () => true });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(true);
      expect(result.isSnapshotFinalizedCallable).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when isSnapshotFinalized reverts", async () => {
      const client = makeClient({
        readContract: async () => { throw new Error("execution reverted"); }
      });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(true);
      expect(result.isSnapshotFinalizedCallable).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("reverted");
    });

    it("fails when isSnapshotFinalized returns non-boolean", async () => {
      const client = makeClient({ readContract: async () => BigInt(1) });

      const result = await validateSnapshotBookInterface(client, VALID_ADDRESS);

      expect(result.hasCode).toBe(true);
      expect(result.isSnapshotFinalizedCallable).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("non-boolean");
    });
  });
});

describe("isSnapshotBookValid", () => {
  it("returns true when all checks pass", () => {
    const v: SnapshotBookValidation = {
      address: VALID_ADDRESS,
      hasCode: true,
      isSnapshotFinalizedCallable: true,
      errors: []
    };
    expect(isSnapshotBookValid(v)).toBe(true);
  });

  it("returns false when hasCode is false", () => {
    const v: SnapshotBookValidation = {
      address: VALID_ADDRESS,
      hasCode: false,
      isSnapshotFinalizedCallable: false,
      errors: ["no bytecode"]
    };
    expect(isSnapshotBookValid(v)).toBe(false);
  });

  it("returns false when isSnapshotFinalizedCallable is false", () => {
    const v: SnapshotBookValidation = {
      address: VALID_ADDRESS,
      hasCode: true,
      isSnapshotFinalizedCallable: false,
      errors: ["reverted"]
    };
    expect(isSnapshotBookValid(v)).toBe(false);
  });

  it("returns false when errors exist even if flags are true", () => {
    const v: SnapshotBookValidation = {
      address: VALID_ADDRESS,
      hasCode: true,
      isSnapshotFinalizedCallable: true,
      errors: ["unexpected warning"]
    };
    expect(isSnapshotBookValid(v)).toBe(false);
  });
});
