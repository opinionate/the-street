import type { WorldEvent } from "./WorldEventBus.js";

const MAX_QUEUE_DEPTH = 5;

/**
 * Priority event queue for a single daemon.
 * Events are ordered by priority (lower number = higher priority).
 * Queue depth is capped at MAX_QUEUE_DEPTH; lowest-priority events are evicted.
 */
export class PriorityEventQueue {
  private queue: WorldEvent[] = [];

  /** Enqueue an event. Returns false if the event was dropped (lower priority than all queued). */
  enqueue(event: WorldEvent): boolean {
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      // Find the lowest-priority (highest number) event
      const lowestIdx = this.findLowestPriorityIndex();
      if (this.queue[lowestIdx].priority <= event.priority) {
        // New event is same or lower priority than everything queued — drop it
        return false;
      }
      // Evict the lowest-priority event to make room
      this.queue.splice(lowestIdx, 1);
    }

    // Insert in priority order (stable: new events go after same-priority ones)
    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > event.priority) {
        insertIdx = i;
        break;
      }
    }
    this.queue.splice(insertIdx, 0, event);
    return true;
  }

  /** Dequeue the highest-priority event, or null if empty. */
  dequeue(): WorldEvent | null {
    return this.queue.shift() ?? null;
  }

  /** Peek at the highest-priority event without removing it. */
  peek(): WorldEvent | null {
    return this.queue[0] ?? null;
  }

  /** Number of queued events. */
  get length(): number {
    return this.queue.length;
  }

  /** Clear all queued events. */
  clear(): void {
    this.queue.length = 0;
  }

  /** Check if queue has events. */
  get hasEvents(): boolean {
    return this.queue.length > 0;
  }

  private findLowestPriorityIndex(): number {
    let idx = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].priority > this.queue[idx].priority) {
        idx = i;
      }
    }
    return idx;
  }
}
