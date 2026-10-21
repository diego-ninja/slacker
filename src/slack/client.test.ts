// src/slack/client.test.ts
// ABOUTME: Contract integration tests for Slack status updates using the real SDK.
// ABOUTME: Verifies HTTP profiles, serialized writes and acknowledged status caching locally.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SlackClient } from './client.js';
import { createSlackApi, waitUntil, type SlackApi } from '../../test/slack-api.js';

describe('SlackClient contract integration', () => {
  let api: SlackApi;

  beforeEach(async () => {
    api = await createSlackApi();
  });

  afterEach(async () => {
    await api.close();
  });

  it('sends an authenticated users.profile.set request with the requested profile', async () => {
    const client = new SlackClient(api.client);
    await client.setStatus({ emoji: ':eyes:', text: 'Reviewing PR #123' });

    expect(api.requests).toEqual([{
      path: '/api/users.profile.set',
      profile: { status_emoji: ':eyes:', status_text: 'Reviewing PR #123' },
      authenticated: true,
    }]);
    expect(client.getStatus()).toEqual({ emoji: ':eyes:', text: 'Reviewing PR #123' });
  });

  it('clears status with an empty profile', async () => {
    const client = new SlackClient(api.client);
    await client.setStatus({ emoji: '', text: '' });

    expect(api.requests[0].profile).toEqual({ status_emoji: '', status_text: '' });
  });

  it('skips redundant updates only after Slack has acknowledged the status', async () => {
    const client = new SlackClient(api.client);
    const status = { emoji: ':eyes:', text: 'Reviewing' };
    await client.setStatus(status);
    await client.setStatus({ ...status });

    expect(api.requests).toHaveLength(1);
  });

  it('does not cache a failed write and allows retrying the same status', async () => {
    api.enqueue({ ok: false, error: 'invalid_auth' });
    const client = new SlackClient(api.client);
    const status = { emoji: ':eyes:', text: 'Reviewing' };

    await expect(client.setStatus(status)).rejects.toMatchObject({ data: { error: 'invalid_auth' } });
    expect(client.getStatus()).toBeNull();
    await client.setStatus(status);

    expect(api.requests).toHaveLength(2);
    expect(client.getStatus()).toEqual(status);
  });

  it('writes a previously acknowledged status again after an intervening failure', async () => {
    const client = new SlackClient(api.client);
    const previous = { emoji: ':eyes:', text: 'Previous' };
    await client.setStatus(previous);
    api.enqueue({ ok: false, error: 'invalid_auth' });

    await expect(client.setStatus({ emoji: ':computer:', text: 'Failed update' }))
      .rejects.toMatchObject({ data: { error: 'invalid_auth' } });
    expect(client.getStatus()).toEqual(previous);
    await client.setStatus(previous);

    expect(api.requests.map((request) => request.profile.status_text)).toEqual(['Previous', 'Failed update', 'Previous']);
    expect(client.getStatus()).toEqual(previous);
  });

  it('serializes concurrent writes and exposes only acknowledged status', async () => {
    const release = api.holdNext();
    const client = new SlackClient(api.client);
    const first = client.setStatus({ emoji: ':eyes:', text: 'First' });
    await waitUntil(() => api.requests.length === 1);
    const second = client.setStatus({ emoji: ':computer:', text: 'Second' });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(api.requests).toHaveLength(1);
      expect(client.getStatus()).toBeNull();
    } finally {
      release();
      await Promise.all([first, second]);
    }

    expect(api.requests.map((request) => request.profile.status_text)).toEqual(['First', 'Second']);
    expect(client.getStatus()).toEqual({ emoji: ':computer:', text: 'Second' });
  });

  it('continues queued updates after a rejected write', async () => {
    const release = api.holdNext({ ok: false, error: 'invalid_auth' });
    const client = new SlackClient(api.client);
    const firstResult = client.setStatus({ emoji: ':eyes:', text: 'First' }).catch((error: unknown) => error);
    await waitUntil(() => api.requests.length === 1);
    const second = client.setStatus({ emoji: ':computer:', text: 'Second' });
    release();

    expect(await firstResult).toMatchObject({ data: { error: 'invalid_auth' } });
    await second;
    expect(client.getStatus()).toEqual({ emoji: ':computer:', text: 'Second' });
  });

  it('truncates text to 100 Unicode characters without splitting a surrogate pair', async () => {
    const client = new SlackClient(api.client);
    const text = '🚀'.repeat(101);
    await client.setStatus({ emoji: ':rocket:', text });

    expect(api.requests[0].profile.status_text).toBe('🚀'.repeat(100));
    expect(client.getStatus()).toEqual({ emoji: ':rocket:', text: '🚀'.repeat(100) });
    await client.setStatus({ emoji: ':rocket:', text: `${text}extra` });
    expect(api.requests).toHaveLength(1);
  });

  it('returns a copy of the acknowledged status', async () => {
    const client = new SlackClient(api.client);
    const status = { emoji: ':eyes:', text: 'Reviewing' };
    await client.setStatus(status);
    status.text = 'Changed input';
    const acknowledged = client.getStatus();
    if (acknowledged) acknowledged.text = 'Changed output';

    expect(client.getStatus()).toEqual({ emoji: ':eyes:', text: 'Reviewing' });
  });
});
