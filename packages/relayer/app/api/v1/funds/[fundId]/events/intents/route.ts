import { NextResponse } from "next/server";
import { relayerEvents } from "@/lib/event-emitter";

export async function GET(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const url = new URL(request.url);
  const lastEventId = url.searchParams.get("lastEventId") || undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const initialEvent = {
        id: `evt-${Date.now()}-init`,
        type: "connected",
        data: { fundId, channel: "intents" },
        timestamp: Date.now(),
      };
      controller.enqueue(
        encoder.encode(`id: ${initialEvent.id}\nevent: ${initialEvent.type}\ndata: ${JSON.stringify(initialEvent.data)}\n\n`)
      );

      const missedEvents = relayerEvents.getHistory(lastEventId);
      for (const event of missedEvents) {
        if (event.type === "intent:attested") {
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        }
      }

      const listener = (event: { id: string; type: string; data: unknown }) => {
        if (event.type === "intent:attested") {
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        }
      };

      relayerEvents.on("event", listener);

      request.signal.addEventListener("abort", () => {
        relayerEvents.off("event", listener);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
