// ABOUTME: Contract integration tests from signed webhooks through SQLite to Slack HTTP.
// ABOUTME: Verifies durable acceptance, ordered delivery, retries and startup recovery locally.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { createServer } from './server.js';
import { SQLiteStore } from './store/sqlite.js';
import type { Config } from './config.js';
import { createSlackApi, waitUntil, type SlackApi } from '../test/slack-api.js';

const githubSecret = 'local-github-secret';
const statusToken = 'local-status-token';
const authorization = { authorization: `Bearer ${statusToken}` };
const testConfig: Config = {
  slack: { token: 'dummy-slack-token' },
  statusToken,
  providers: { github: { webhookSecret: githubSecret, username: 'diego' } },
  rules: [{ event: 'pr:review_requested', status: { emoji: ':eyes:', text: 'Reviewing ${identifier}' } }],
  defaultStatus: { emoji: '', text: '' },
};

function reviewPayload(number: number, updatedAt = '2026-10-21T10:00:00.000Z') {
  return {
    action: 'review_requested',
    pull_request: {
      number,
      title: `PR ${number}`,
      html_url: `https://github.com/org/repo/pull/${number}`,
      user: { login: 'other' },
      created_at: '2026-10-20T09:00:00.000Z',
      updated_at: updatedAt,
      state: 'open',
      requested_reviewers: [{ login: 'diego' }],
    },
    requested_reviewer: { login: 'diego' },
    repository: { full_name: 'org/repo' },
    sender: { login: 'other' },
  };
}

async function postReview(server: FastifyInstance, number: number, updatedAt?: string) {
  const payload = JSON.stringify(reviewPayload(number, updatedAt), null, 2);
  return server.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': `sha256=${createHmac('sha256', githubSecret).update(payload).digest('hex')}`,
    },
    payload,
  });
}

async function diagnostics(server: FastifyInstance) {
  const response = await server.inject({ method: 'GET', url: '/status', headers: authorization });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe('Webhook and Slack contract integration', () => {
  let api: SlackApi;
  let servers: FastifyInstance[];
  let directory: string;
  let dbPath: string;

  beforeEach(async () => {
    api = await createSlackApi();
    servers = [];
    directory = mkdtempSync(join(tmpdir(), 'slacker-contract-'));
    dbPath = join(directory, 'state.db');
  });

  afterEach(async () => {
    api.releaseAll();
    for (const server of servers) await server.close();
    await api.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function start(syncIntervalMs = 30000) {
    const server = createServer(testConfig, dbPath, { webClient: api.client, logger: false, syncIntervalMs });
    servers.push(server);
    return server;
  }

  async function initialize(server: FastifyInstance, expectedRequestCount = 1) {
    await server.ready();
    await waitUntil(() => api.requests.length >= expectedRequestCount);
    await waitUntil(async () => (await diagnostics(server)).pending === false);
  }

  it('accepts a signed raw webhook durably before Slack acknowledgement', async () => {
    const server = start();
    await initialize(server);
    const release = api.holdNext();

    const response = await postReview(server, 42);
    expect(response.statusCode).toBe(200);
    await waitUntil(() => api.requests.length === 2);

    const reader = new SQLiteStore(dbPath);
    try {
      expect(reader.get('github:pr:org/repo:42')).toMatchObject({ active: true, type: 'pr:review_requested' });
    } finally {
      reader.close();
    }
    expect(await diagnostics(server)).toMatchObject({
      currentStatus: { emoji: ':eyes:', text: 'Reviewing #42' },
      lastAppliedStatus: { emoji: '', text: '' },
      pending: true,
      lastError: null,
    });
    expect(api.requests[1]).toEqual({
      path: '/api/users.profile.set',
      profile: { status_emoji: ':eyes:', status_text: 'Reviewing #42' },
      authenticated: true,
    });

    release();
    await waitUntil(async () => (await diagnostics(server)).pending === false);
    expect((await diagnostics(server)).lastAppliedStatus).toEqual({ emoji: ':eyes:', text: 'Reviewing #42' });

    expect((await postReview(server, 42)).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(api.requests).toHaveLength(2);
  });

  it('persists a newer desired status while a prior delivery is in flight and applies it next', async () => {
    const server = start();
    await initialize(server);
    const release = api.holdNext();
    expect((await postReview(server, 42)).statusCode).toBe(200);
    await waitUntil(() => api.requests.length === 2);
    expect((await postReview(server, 43, '2026-10-21T10:01:00.000Z')).statusCode).toBe(200);

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(api.requests).toHaveLength(2);
      expect(await diagnostics(server)).toMatchObject({
        currentStatus: { emoji: ':eyes:', text: 'Reviewing #43' },
        lastAppliedStatus: { emoji: '', text: '' },
        pending: true,
      });
    } finally {
      release();
    }

    await waitUntil(async () => (await diagnostics(server)).pending === false);
    expect(api.requests.map((request) => request.profile.status_text)).toEqual(['', 'Reviewing #42', 'Reviewing #43']);
    expect((await diagnostics(server)).lastAppliedStatus).toEqual({ emoji: ':eyes:', text: 'Reviewing #43' });
  });

  it('recovers a failed Slack write on the recovery interval without another webhook', async () => {
    const server = start(150);
    await initialize(server);
    api.enqueue({ ok: false, error: 'invalid_auth' });
    expect((await postReview(server, 42)).statusCode).toBe(200);
    await waitUntil(async () => (await diagnostics(server)).lastError === 'invalid_auth');

    expect(await diagnostics(server)).toMatchObject({
      currentStatus: { emoji: ':eyes:', text: 'Reviewing #42' },
      lastAppliedStatus: { emoji: '', text: '' },
      pending: true,
    });
    await waitUntil(async () => (await diagnostics(server)).pending === false);
    expect(api.requests.map((request) => request.profile.status_text)).toEqual(['', 'Reviewing #42', 'Reviewing #42']);
    expect(await diagnostics(server)).toMatchObject({
      lastAppliedStatus: { emoji: ':eyes:', text: 'Reviewing #42' },
      lastError: null,
    });
  });

  it('retries the latest persisted state when another event follows a failure', async () => {
    const server = start();
    await initialize(server);
    api.enqueue({ ok: false, error: 'invalid_auth' });
    expect((await postReview(server, 42)).statusCode).toBe(200);
    await waitUntil(async () => (await diagnostics(server)).lastError === 'invalid_auth');

    expect((await postReview(server, 43, '2026-10-21T10:01:00.000Z')).statusCode).toBe(200);
    await waitUntil(async () => (await diagnostics(server)).pending === false);

    expect(api.requests.map((request) => request.profile.status_text)).toEqual(['', 'Reviewing #42', 'Reviewing #43']);
    expect((await diagnostics(server)).lastAppliedStatus).toEqual({ emoji: ':eyes:', text: 'Reviewing #43' });
  });

  it('reapplies a persisted desired status after restart following failed delivery', async () => {
    const firstServer = start();
    await initialize(firstServer);
    api.enqueue({ ok: false, error: 'invalid_auth' });
    expect((await postReview(firstServer, 42)).statusCode).toBe(200);
    await waitUntil(async () => (await diagnostics(firstServer)).lastError === 'invalid_auth');
    await firstServer.close();
    const requestCount = api.requests.length;

    const secondServer = start();
    await initialize(secondServer, requestCount + 1);

    expect(api.requests.at(-1)?.profile).toEqual({ status_emoji: ':eyes:', status_text: 'Reviewing #42' });
    const status = await diagnostics(secondServer);
    expect(status.activeEvents).toHaveLength(1);
    expect(status).toMatchObject({
      currentStatus: { emoji: ':eyes:', text: 'Reviewing #42' },
      lastAppliedStatus: { emoji: ':eyes:', text: 'Reviewing #42' },
      pending: false,
      lastError: null,
    });
  });

  it('rejects an invalid signature without persisting or delivering a new status', async () => {
    const server = start();
    await initialize(server);
    const response = await server.inject({
      method: 'POST', url: '/webhooks/github',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=invalid' },
      payload: reviewPayload(42),
    });

    expect(response.statusCode).toBe(401);
    expect((await diagnostics(server)).activeEvents).toEqual([]);
    expect(api.requests).toHaveLength(1);
  });
});
