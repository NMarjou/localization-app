/**
 * Tiny in-memory ring buffer for recent service events. Feeds the /status
 * endpoint and the UI dashboard. Lost on restart — for durable audit, keep
 * mining the structured log file.
 */
const MAX_EVENTS = 200;
const events = [];
let nextId = 1;
export function recordEvent(type, message, details) {
    const ev = {
        id: `e${nextId++}`,
        timestamp: Date.now(),
        type,
        message,
        details,
    };
    events.unshift(ev);
    if (events.length > MAX_EVENTS)
        events.length = MAX_EVENTS;
}
export function listEvents(limit = 50) {
    return events.slice(0, limit);
}
let startedAt = Date.now();
export function getStartedAt() {
    return startedAt;
}
export function resetStartedAt() {
    startedAt = Date.now();
}
//# sourceMappingURL=event-log.js.map