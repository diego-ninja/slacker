// ABOUTME: HTTP server contract tests for diagnostics and delivery lifecycle.
// ABOUTME: Uses a local Slack API to observe startup recovery and graceful shutdown.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from './server.js';
import type { Config } from './config.js';
import { createSlackApi, waitUntil, type SlackApi } from '../test/slack-api.js';

const testConfig: Config = {
  slack: { token: 'dummy-slack-token' },
  providers: {},
  rules: [],
  defaultStatus: { emoji: '', text: '' },
};
const statusToken = 'local-status-token';
const authorization = { authorization: `Bearer ${statusToken}` };

describe('Server contract integration', () => {
  let api: SlackApi;
  let servers: FastifyInstance[];

  beforeEach(async () => {
    api = await createSlackApi();
    servers = [];
  });

  afterEach(async () => {
    api.releaseAll();
    for (const server of servers) await server.close();
    await api.close();
  });

  function start(config: Config = testConfig, syncIntervalMs = 30000) {
    const server = createServer(config, ':memory:', { webClient: api.client, logger: false, syncIntervalMs });
    servers.push(server);
    return server;
  }

  it('keeps health responsive while startup Slack delivery is pending', async () => {
    const release = api.holdNext();
    const server = start({ ...testConfig, statusToken });
    await server.ready();
    await waitUntil(() => api.requests.length === 1);

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    const diagnostics = await server.inject({ method: 'GET', url: '/status', headers: authorization });
    expect(diagnostics.json()).toMatchObject({
      currentStatus: { emoji: '', text: '' },
      lastAppliedStatus: null,
      pending: true,
      lastError: null,
    });
    release();
  });

  it('disables the status endpoint without an explicit token', async () => {
    const server = start();
    const response = await server.inject({ method: 'GET', url: '/status' });

    expect(response.statusCode).toBe(404);
  });

  it.each([undefined, 'Bearer incorrect', `Basic ${statusToken}`, 'Bearer x'])('requires a valid bearer token: %s', async (header) => {
    const server = start({ ...testConfig, statusToken });
    const response = await server.inject({
      method: 'GET', url: '/status', headers: header ? { authorization: header } : {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(statusToken);
    expect(response.body).not.toContain('dummy-slack-token');
  });

  it('reports desired status separately from the last Slack acknowledgement', async () => {
    const server = start({ ...testConfig, statusToken });
    await server.ready();
    await waitUntil(() => api.requests.length === 1);
    await waitUntil(async () => {
      const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
      return response.json().pending === false;
    });

    const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      activeEvents: [],
      currentStatus: { emoji: '', text: '' },
      lastAppliedStatus: { emoji: '', text: '' },
      pending: false,
      lastError: null,
    });
  });

  it('reports a safe failure code while keeping liveness healthy', async () => {
    api.enqueue({ ok: false, error: 'invalid_auth', response_metadata: { messages: ['[ERROR] private-credential-detail'] } });
    const server = start({ ...testConfig, statusToken });
    await server.ready();
    await waitUntil(() => api.requests.length === 1);
    await waitUntil(async () => {
      const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
      return response.json().lastError !== null;
    });

    const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
    expect(response.json()).toMatchObject({ pending: true, lastAppliedStatus: null, lastError: 'invalid_auth' });
    expect(response.body).not.toContain('private-credential-detail');
    expect(response.body).not.toContain('dummy-slack-token');
    expect(api.logs.some((entry) => entry.level === 'error' && entry.messages.includes('private-credential-detail'))).toBe(true);
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toEqual({ ok: true });
  });

  it('drains in-flight delivery on close and stops recovery attempts', async () => {
    const release = api.holdNext();
    const server = start(testConfig, 15);
    await server.ready();
    await waitUntil(() => api.requests.length === 1);
    let closed = false;
    const closing = server.close().then(() => { closed = true; });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(closed).toBe(false);
    } finally {
      release();
      await closing;
    }
    const requestCount = api.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.requests).toHaveLength(requestCount);
  });

  it('bounds shutdown when the Slack endpoint does not acknowledge a request', async () => {
    api.holdNext();
    const server = start();
    await server.ready();
    await waitUntil(() => api.requests.length === 1);

    const startedAt = Date.now();
    await server.close();

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(api.logs.some((entry) => entry.level === 'warn' && entry.messages[0] === 'http request failed')).toBe(true);
  });

  it('respects Retry-After before recovering the latest desired status', async () => {
    api.rateLimitNext(1);
    const secret = 'local-github-secret';
    const server = start({
      ...testConfig,
      statusToken,
      providers: { github: { webhookSecret: secret, username: 'diego' } },
      rules: [{ event: 'pr:authored:open', status: { emoji: ':eyes:', text: 'PR ${identifier}' } }],
    }, 20);
    await server.ready();
    await waitUntil(() => api.requests.length === 1);
    await waitUntil(async () => {
      const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
      return response.json().lastError !== null;
    });
    const limitedAt = Date.now();
    const payload = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'org/repo' },
      pull_request: {
        number: 42,
        title: 'Latest work',
        html_url: 'https://github.com/org/repo/pull/42',
        user: { login: 'diego' },
        state: 'open',
        created_at: '2026-10-21T10:00:00.000Z',
        updated_at: '2026-10-21T10:01:00.000Z',
      },
    });
    const accepted = await server.inject({
      method: 'POST', url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
      },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(api.requests).toHaveLength(1);
    const pending = await server.inject({ method: 'GET', url: '/status', headers: authorization });
    expect(pending.json()).toMatchObject({
      currentStatus: { emoji: ':eyes:', text: 'PR #42' },
      lastAppliedStatus: null,
      pending: true,
    });

    await waitUntil(() => api.requests.length === 2, 2500);
    expect(Date.now() - limitedAt).toBeGreaterThanOrEqual(950);
    await waitUntil(async () => {
      const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
      return response.json().pending === false;
    });
    expect(api.requests[1].profile).toEqual({ status_emoji: ':eyes:', status_text: 'PR #42' });
    expect(api.logs.some((entry) => entry.level === 'warn'
      && entry.messages[0] === 'http request failed'
      && String(entry.messages[1]).includes('rate-limit'))).toBe(true);
    const recovered = await server.inject({ method: 'GET', url: '/status', headers: authorization });
    expect(recovered.json()).toMatchObject({
      lastAppliedStatus: { emoji: ':eyes:', text: 'PR #42' },
      pending: false,
      lastError: null,
    });
  });
});
