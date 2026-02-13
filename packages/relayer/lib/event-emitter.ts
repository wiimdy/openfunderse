import { EventEmitter } from "node:events";

export interface SseEvent {
  id: string;
  type: string;
  data: unknown;
  timestamp: number;
}

class RelayerEventEmitter extends EventEmitter {
  private history: SseEvent[] = [];
  private readonly MAX_HISTORY = 100;

  constructor() {
    super();
    this.setMaxListeners(1000); // Allow many SSE connections
  }

  emitEvent(type: string, data: unknown) {
    const event: SseEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      data,
      timestamp: Date.now(),
    };

    this.history.push(event);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }

    this.emit("event", event);
    return event;
  }

  getHistory(lastEventId?: string): SseEvent[] {
    if (!lastEventId) return [];
    
    const index = this.history.findIndex((e) => e.id === lastEventId);
    if (index === -1) {
      // If ID not found, return all history (client might be too old, or ID is invalid)
      return this.history;
    }
    
    return this.history.slice(index + 1);
  }
}

export const relayerEvents = new RelayerEventEmitter();
