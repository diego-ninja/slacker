// src/integration.test.ts
// ABOUTME: End-to-end integration tests
// ABOUTME: Validates full webhook flow from receipt to status update

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { createServer } from './server.js';
import type { Config } from './config.js';

const GITHUB_SECRET = 'test-github-secret';

const testConfig: Config = {
  slack: { token: 'xoxb-test' },
  providers: {
    github: { webhookSecret: GITHUB_SECRET },
  },
  rules: [
    {
      event: 'pr:review_requested',
      status: { emoji: ':eyes:', text: 'Reviewing ${identifier}' },
    },
  ],
  defaultStatus: { emoji: '', text: '' },
};

function signPayload(payload: object, secret: string): string {
  const body = JSON.stringify(payload);
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('Integration', () => {
  beforeEach(() => {
    process.env.GITHUB_USERNAME = 'diego';
  });

  it('processes GitHub webhook and updates status', async () => {
    const server = createServer(testConfig, ':memory:');

    const payload = {
      action: 'review_requested',
      pull_request: {
        number: 42,
        title: 'Test PR',
        html_url: 'https://github.com/org/repo/pull/42',
        user: { login: 'other' },
      },
      requested_reviewer: { login: 'diego' },
      repository: { full_name: 'org/repo' },
      sender: { login: 'other' },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signPayload(payload, GITHUB_SECRET),
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/status',
    });

    const status = statusResponse.json();
    expect(status.activeEvents).toHaveLength(1);
    expect(status.currentStatus.emoji).toBe(':eyes:');
    expect(status.currentStatus.text).toBe('Reviewing #42');

    await server.close();
  });

  it('rejects webhook with invalid signature', async () => {
    const server = createServer(testConfig, ':memory:');

    const payload = { action: 'opened' };

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=invalid',
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);

    await server.close();
  });
});
