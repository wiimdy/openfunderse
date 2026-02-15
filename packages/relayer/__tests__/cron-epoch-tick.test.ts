import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/cron/epoch-tick/route";
import { tickAllFunds, type TickResult } from "@/lib/epoch-manager";

vi.mock("@/lib/epoch-manager", () => ({
  tickAllFunds: vi.fn()
}));

const mockTickAllFunds = vi.mocked(tickAllFunds);
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const FIXED_NOW = 1700000000000;

describe("POST /api/v1/cron/epoch-tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_CRON_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    }
  });

  it("returns 401 when CRON_SECRET is set and header is missing", async () => {
    process.env.CRON_SECRET = "test-secret";

    const request = new Request("http://localhost/api/v1/cron/epoch-tick", {
      method: "POST"
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "UNAUTHORIZED", message: "invalid cron secret" });
    expect(mockTickAllFunds).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is set and header is wrong", async () => {
    process.env.CRON_SECRET = "test-secret";

    const request = new Request("http://localhost/api/v1/cron/epoch-tick", {
      method: "POST",
      headers: { "x-cron-secret": "wrong-secret" }
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "UNAUTHORIZED", message: "invalid cron secret" });
    expect(mockTickAllFunds).not.toHaveBeenCalled();
  });

  it("returns 200 with results when CRON_SECRET matches", async () => {
    process.env.CRON_SECRET = "test-secret";
    const results: TickResult[] = [
      { action: "NOOP", fundId: "fund-1", reason: "epoch still active" }
    ];
    mockTickAllFunds.mockResolvedValue(results);

    const request = new Request("http://localhost/api/v1/cron/epoch-tick", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" }
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "OK",
      endpoint: "POST /api/v1/cron/epoch-tick",
      timestamp: FIXED_NOW,
      processed: 1,
      results
    });
  });

  it("returns 200 without auth check when CRON_SECRET is not set", async () => {
    const results: TickResult[] = [{ action: "OPENED", fundId: "fund-2", epochId: "9" }];
    mockTickAllFunds.mockResolvedValue(results);

    const request = new Request("http://localhost/api/v1/cron/epoch-tick", {
      method: "POST"
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockTickAllFunds).toHaveBeenCalledTimes(1);
  });

  it("passes nowMs and returns all tick results in response body", async () => {
    const results: TickResult[] = [
      { action: "AGGREGATED", fundId: "fund-a", epochId: "2", epochStateHash: "0xabc" },
      { action: "EXTENDED", fundId: "fund-b", epochId: "3", newClosesAt: FIXED_NOW + 3000 }
    ];
    mockTickAllFunds.mockResolvedValue(results);

    const request = new Request("http://localhost/api/v1/cron/epoch-tick", {
      method: "POST"
    });
    const response = await POST(request);
    const body = await response.json();

    expect(mockTickAllFunds).toHaveBeenCalledWith({ nowMs: FIXED_NOW });
    expect(body.processed).toBe(2);
    expect(body.results).toEqual(results);
  });
});
