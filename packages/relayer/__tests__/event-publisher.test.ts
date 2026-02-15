import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishEvent } from "@/lib/event-publisher";
import { insertOutboxEvent, type EventsOutboxRow } from "@/lib/supabase";
import { relayerEvents } from "@/lib/event-emitter";

vi.mock("@/lib/supabase", () => ({
  insertOutboxEvent: vi.fn()
}));

vi.mock("@/lib/event-emitter", () => ({
  relayerEvents: {
    emitEvent: vi.fn()
  }
}));

const mockInsertOutboxEvent = vi.mocked(insertOutboxEvent);
const mockEmitEvent = vi.mocked(relayerEvents.emitEvent);

const createOutboxRow = (id: number, eventType: string, fundId: string): EventsOutboxRow => ({
  id,
  event_type: eventType,
  fund_id: fundId,
  payload: { ok: true },
  created_at: 1700000000000
});

describe("publishEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes to outbox and emits in-memory event", async () => {
    const eventType = "epoch:opened";
    const fundId = "fund-1";
    const payload = { epochId: "1", closesAt: 1700000001000 };
    const row = createOutboxRow(11, eventType, fundId);

    mockInsertOutboxEvent.mockResolvedValue(row);

    const result = await publishEvent(eventType, fundId, payload);

    expect(mockInsertOutboxEvent).toHaveBeenCalledWith({ eventType, fundId, payload });
    expect(mockEmitEvent).toHaveBeenCalledWith(eventType, { id: row.id, fundId, ...payload });
    expect(result).toEqual(row);
  });

  it("passes fundId in the emitted payload", async () => {
    const eventType = "intent:proposed";
    const fundId = "fund-xyz";
    const payload = { intentHash: "0xabc", epochId: "5" };
    const row = createOutboxRow(12, eventType, fundId);

    mockInsertOutboxEvent.mockResolvedValue(row);

    await publishEvent(eventType, fundId, payload);

    expect(mockEmitEvent).toHaveBeenCalledWith(eventType, {
      id: row.id,
      fundId,
      intentHash: "0xabc",
      epochId: "5"
    });
  });

  it("propagates insertOutboxEvent errors", async () => {
    mockInsertOutboxEvent.mockRejectedValue(new Error("insert failed"));

    await expect(publishEvent("intent:ready", "fund-2", { intentHash: "0x1" })).rejects.toThrow(
      "insert failed"
    );
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("handles various event types", async () => {
    const fundId = "fund-multi";
    const cases = ["epoch:opened", "epoch:closed", "epoch:aggregated", "intent:attested"] as const;

    for (let index = 0; index < cases.length; index += 1) {
      const eventType = cases[index];
      const payload = { marker: `payload-${index}` };
      mockInsertOutboxEvent.mockResolvedValueOnce(createOutboxRow(index + 20, eventType, fundId));

      const row = await publishEvent(eventType, fundId, payload);

      expect(row.id).toBe(index + 20);
    }

    expect(mockInsertOutboxEvent).toHaveBeenCalledTimes(cases.length);
    expect(mockEmitEvent).toHaveBeenCalledTimes(cases.length);
    expect(mockEmitEvent.mock.calls.map(([eventType]) => eventType)).toEqual(cases);
  });
});
