/**
 * Tiny in-memory ring buffer for recent service events. Feeds the /status
 * endpoint and the UI dashboard. Lost on restart — for durable audit, keep
 * mining the structured log file.
 */
export type EventType = "webhook_received" | "webhook_ignored" | "webhook_completed" | "backfill_started" | "backfill_completed" | "translation_pushed" | "error";
export interface ServiceEvent {
    id: string;
    timestamp: number;
    type: EventType;
    message: string;
    details?: Record<string, unknown>;
}
export declare function recordEvent(type: EventType, message: string, details?: Record<string, unknown>): void;
export declare function listEvents(limit?: number): ServiceEvent[];
export declare function getStartedAt(): number;
export declare function resetStartedAt(): void;
//# sourceMappingURL=event-log.d.ts.map