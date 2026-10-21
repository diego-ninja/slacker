// ABOUTME: Delivers the latest persisted desired status through one serialized worker
// ABOUTME: Tracks acknowledgement failures and respects Slack retry cooldowns

import type { SlackStatus } from '../types.js';
import type { SlackClient } from './client.js';

export class StatusSync {
  private running: Promise<void> | null = null;
  private requested = false;
  private stopped = false;
  private retryAt = 0;
  private lastError: string | null = null;

  constructor(
    private readStatus: () => SlackStatus,
    private client: SlackClient,
    private onError: (code: string) => void,
  ) {}

  sync(): Promise<void> {
    if (this.stopped || Date.now() < this.retryAt) return Promise.resolve();
    this.requested = true;
    if (!this.running) {
      this.running = this.deliver().finally(() => {
        this.running = null;
        if (this.requested && !this.stopped) void this.sync();
      });
    }
    return this.running;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  isPending(): boolean {
    const desired = this.readStatus();
    const applied = this.client.getStatus();
    return this.running !== null || this.lastError !== null
      || !applied || desired.text !== applied.text || desired.emoji !== applied.emoji;
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  private async deliver(): Promise<void> {
    do {
      this.requested = false;
      try {
        await this.client.setStatus(this.readStatus());
        this.lastError = null;
      } catch (error) {
        this.lastError = failureCode(error);
        if (typeof error === 'object' && error !== null && 'retryAfter' in error) {
          const seconds = error.retryAfter;
          if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
            this.retryAt = Date.now() + seconds * 1000;
          }
        }
        this.onError(this.lastError);
        return;
      }
    } while (this.requested && !this.stopped);
  }
}

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'error' in data
      && typeof data.error === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(data.error)) {
      return data.error;
    }
  }
  return 'slack_update_failed';
}
