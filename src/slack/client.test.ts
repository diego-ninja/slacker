// src/slack/client.test.ts
// ABOUTME: Tests for Slack status update client
// ABOUTME: Uses mock to verify API calls without hitting real Slack

import { describe, it, expect, vi } from 'vitest';
import { SlackClient } from './client.js';
import type { SlackStatus } from '../types.js';

describe('SlackClient', () => {
  it('calls users.profile.set with correct parameters', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);
    const status: SlackStatus = {
      emoji: ':eyes:',
      text: 'Reviewing PR #123',
    };

    await client.setStatus(status);

    expect(mockSet).toHaveBeenCalledWith({
      profile: {
        status_emoji: ':eyes:',
        status_text: 'Reviewing PR #123',
      },
    });
  });

  it('clears status when emoji and text are empty', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);

    await client.setStatus({ emoji: '', text: '' });

    expect(mockSet).toHaveBeenCalledWith({
      profile: {
        status_emoji: '',
        status_text: '',
      },
    });
  });

  it('skips update if status unchanged', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);
    const status: SlackStatus = { emoji: ':eyes:', text: 'Reviewing' };

    await client.setStatus(status);
    await client.setStatus(status);

    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
