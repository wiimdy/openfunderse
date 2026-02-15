import { NextRequest, NextResponse } from "next/server";
import { relayerEvents, SseEvent } from "@/lib/event-emitter";
import { listOutboxEventsSince } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function parseTypesParam(typesParam: string | null): Set<string> | null {
  if (!typesParam) return null;
  const values = typesParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return null;
  return new Set(values);
}

function parseLastEventId(lastEventIdHeader: string | null): number | null {
  if (!lastEventIdHeader) return null;
  const value = Number(lastEventIdHeader);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function shouldSendEvent(input: {
  eventType: string;
  eventFundId?: string;
  fundIdFilter?: string;
  typeFilter: Set<string> | null;
}): boolean {
  if (input.typeFilter && !input.typeFilter.has(input.eventType)) return false;
  if (input.fundIdFilter && input.eventFundId !== input.fundIdFilter) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const fundIdFilter = request.nextUrl.searchParams.get("fundId") ?? undefined;
  const typeFilter = parseTypesParam(request.nextUrl.searchParams.get("types"));
  const lastEventId = parseLastEventId(request.headers.get("Last-Event-ID"));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (eventType: string, id: number | string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${eventType}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n`));
        controller.enqueue(encoder.encode(`id: ${id}\n\n`));
      };

      if (lastEventId !== null && fundIdFilter) {
        const replayRows = await listOutboxEventsSince({
          fundId: fundIdFilter,
          afterId: lastEventId,
          limit: 500
        });

        for (const row of replayRows) {
          if (
            !shouldSendEvent({
              eventType: row.event_type,
              eventFundId: row.fund_id,
              fundIdFilter,
              typeFilter
            })
          ) {
            continue;
          }

          sendEvent(row.event_type, row.id, {
            fundId: row.fund_id,
            ...row.payload
          });
        }
      }

      const listener = (event: SseEvent) => {
        const eventPayload = event.data as Record<string, unknown>;
        const eventFundId =
          typeof eventPayload.fundId === "string" ? eventPayload.fundId : undefined;

        if (
          !shouldSendEvent({
            eventType: event.type,
            eventFundId,
            fundIdFilter,
            typeFilter
          })
        ) {
          return;
        }

        const eventId =
          typeof eventPayload.id === "number" || typeof eventPayload.id === "string"
            ? eventPayload.id
            : event.id;

        sendEvent(event.type, eventId, {
          ...eventPayload,
          fundId: eventFundId
        });
      };

      relayerEvents.on("event", listener);

      request.signal.addEventListener("abort", () => {
        relayerEvents.off("event", listener);
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
