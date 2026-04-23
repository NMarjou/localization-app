/**
 * Tiny in-memory ring buffer for recent service events. Feeds the /status
 * endpoint and the UI dashboard. Lost on restart — for durable audit, keep
 * mining the structured log file.
 */

export type EventType =
  | "webhook_received"
  | "webhook_ignored"
  | "webhook_completed"
  | "backfill_started"
  | "backfill_completed"
  | "translation_pushed"
  | "error";

export interface ServiceEvent {
  id: string;
  timestamp: number;
  type: EventType;
  message: string;
  details?: Record<string, unknown>;
}

const MAX_EVENTS = 200;
const events: ServiceEvent[] = [];
let nextId = 1;

export function recordEvent(
  type: EventType,
  message: string,
  details?: Record<string, unknown>
): void {
  const ev: ServiceEvent = {
    id: `e${nextId++}`,
    timestamp: Date.now(),
    type,
    message,
    details,
  };
  events.unshift(ev);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function listEvents(limit = 50): ServiceEvent[] {
  return events.slice(0, limit);
}

let startedAt = Date.now();
export function getStartedAt(): number {
  return startedAt;
}
export function resetStartedAt(): void {
  startedAt = Date.now();
}
