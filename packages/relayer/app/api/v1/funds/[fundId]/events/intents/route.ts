import { NextRequest, NextResponse } from "next/server";
import { relayerEvents, SseEvent } from "@/lib/event-emitter";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const lastEventId = request.headers.get("Last-Event-ID") || undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: SseEvent) => {
        const data = event.data as { fundId?: string };
        // Filter by fundId if present in data
        if (data && data.fundId && data.fundId !== fundId) {
          return;
        }

        controller.enqueue(encoder.encode(`event: ${event.type}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n`));
        controller.enqueue(encoder.encode(`id: ${event.id}\n\n`));
      };

      // Send history
      const history = relayerEvents.getHistory(lastEventId);
      for (const event of history) {
        if (event.type === "intent:attested") {
          sendEvent(event);
        }
      }

      // Subscribe to new events
      const listener = (event: SseEvent) => {
        if (event.type === "intent:attested") {
          sendEvent(event);
        }
      };

      relayerEvents.on("event", listener);

      // Cleanup
      request.signal.addEventListener("abort", () => {
        relayerEvents.off("event", listener);
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
