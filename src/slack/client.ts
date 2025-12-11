// src/slack/client.ts
// ABOUTME: Slack API client for updating user status
// ABOUTME: Caches current status to avoid redundant API calls

import type { WebClient } from '@slack/web-api';
import type { SlackStatus } from '../types.js';

export class SlackClient {
  private currentStatus: SlackStatus | null = null;

  constructor(private client: WebClient) {}

  async setStatus(status: SlackStatus): Promise<void> {
    if (this.isSameStatus(status)) {
      return;
    }

    await this.client.users.profile.set({
      profile: {
        status_emoji: status.emoji,
        status_text: status.text,
      },
    });

    this.currentStatus = status;
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
