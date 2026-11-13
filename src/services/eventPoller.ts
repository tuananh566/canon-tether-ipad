/**
 * Event-polling service for Canon CCAPI.
 *
 * Runs a continuous long-poll loop and invokes a callback whenever the
 * camera reports new content (i.e. a photo was just taken).
 *
 * Features:
 *  • Automatic reconnection with exponential back-off.
 *  • Pause / resume / stop controls.
 *  • Observable status for the UI.
 */

import { EventPollingResponse } from '../types/ccapi';
import { CcapiService } from './ccapi';

export type EventCallback = (event: EventPollingResponse) => void;
export type StatusCallback = (status: EventPollerStatus) => void;

export type EventPollerStatus = 'idle' | 'polling' | 'reconnecting' | 'stopped' | 'error';

const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

export class EventPoller {
  private abortController: AbortController | null = null;
  private running = false;
  private paused = false;
  private retryCount = 0;
  private _status: EventPollerStatus = 'idle';
  private statusListeners = new Set<StatusCallback>();
  private eventListeners = new Set<EventCallback>();

  constructor(private ccapi: CcapiService) {}

  // ── Public API ────────────────────────────────────────────────

  get status(): EventPollerStatus {
    return this._status;
  }

  /** Start the long-poll loop. Safe to call if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.retryCount = 0;
    this.loop();
  }

  /** Pause polling without tearing down state. */
  pause(): void {
    this.paused = true;
    this.abortController?.abort();
    this.setStatus('idle');
  }

  /** Resume after pause. */
  resume(): void {
    if (!this.running) {
      this.start();
      return;
    }
    if (!this.paused) return;
    this.paused = false;
    this.retryCount = 0;
    this.loop();
  }

  /** Stop the loop entirely. */
  stop(): void {
    this.running = false;
    this.paused = false;
    this.abortController?.abort();
    this.setStatus('stopped');
  }

  /** Subscribe to new-content events. Returns an unsubscribe function. */
  onEvent(cb: EventCallback): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  // ── Internals ─────────────────────────────────────────────────

  private setStatus(s: EventPollerStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const cb of this.statusListeners) {
      try {
        cb(s);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.running && !this.paused) {
      this.abortController = new AbortController();
      this.setStatus('polling');

      try {
        const event = await this.ccapi.pollEvents(this.abortController.signal);
        this.retryCount = 0; // successful poll resets counter

        const hasContent =
          (event.addedcontents && event.addedcontents.length > 0) ||
          (event.updatedcontents && event.updatedcontents.length > 0);

        if (hasContent) {
          for (const cb of this.eventListeners) {
            try {
              cb(event);
            } catch {
              /* swallow */
            }
          }
        }
      } catch (err) {
        if (!this.running || this.paused) break;

        this.retryCount++;
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1),
          MAX_RETRY_DELAY_MS,
        );
        console.warn(
          `[EventPoller] poll error (attempt ${this.retryCount}), retrying in ${delay} ms`,
          err,
        );
        this.setStatus('reconnecting');
        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
