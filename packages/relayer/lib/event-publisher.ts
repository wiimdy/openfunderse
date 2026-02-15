import { insertOutboxEvent, type EventsOutboxRow } from "@/lib/supabase";
import { relayerEvents } from "@/lib/event-emitter";

export type EpochEventType = "epoch:opened" | "epoch:closed" | "epoch:aggregated";
export type IntentEventType = "intent:proposed" | "intent:attested" | "intent:ready";
export type EventType = EpochEventType | IntentEventType;

export async function publishEvent(
  eventType: EventType,
  fundId: string,
  payload: Record<string, unknown>
): Promise<EventsOutboxRow> {
  const row = await insertOutboxEvent({ eventType, fundId, payload });

  relayerEvents.emitEvent(eventType, {
    id: row.id,
    fundId,
    ...payload
  });

  return row;
}
