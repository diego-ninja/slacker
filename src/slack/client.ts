// src/slack/client.ts
// ABOUTME: Slack API client for updating user status
// ABOUTME: Caches current status to avoid redundant API calls

import type { WebClient } from '@slack/web-api';
import type { SlackStatus } from '../types.js';

export class SlackClient {
  private currentStatus: SlackStatus | null = null;
  private delivery = Promise.resolve();
  private cacheValid = true;

  constructor(private client: WebClient) {}

  setStatus(status: SlackStatus): Promise<void> {
    const formatted = formatStatus(status);
    const update = this.delivery.then(async () => {
      if (this.cacheValid && this.isSameStatus(formatted)) return;
      this.cacheValid = false;
      await this.client.users.profile.set({
        profile: {
          status_emoji: formatted.emoji,
          status_text: formatted.text,
        },
      });
      this.currentStatus = formatted;
      this.cacheValid = true;
    });
    this.delivery = update.catch(() => {});
    return update;
  }

  getStatus(): SlackStatus | null {
    return this.currentStatus ? { ...this.currentStatus } : null;
  }

  private isSameStatus(status: SlackStatus): boolean {
    if (!this.currentStatus) {
      return false;
    }
    return (
      this.currentStatus.emoji === status.emoji &&
      this.currentStatus.text === status.text
    );
  }
}

export function formatStatus(status: SlackStatus): SlackStatus {
  return { emoji: status.emoji, text: Array.from(status.text).slice(0, 100).join('') };
}
