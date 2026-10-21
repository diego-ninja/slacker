// ABOUTME: Exercises signed webhook bodies through real Fastify routes
// ABOUTME: Verifies authentication, validation, and durable async acceptance

import Fastify from 'fastify';
import { createHmac } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubProvider } from './github.js';
import { LinearProvider } from './linear.js';
import type { StatusEvent } from '../types.js';

const SECRET = 'test-secret';
const DATE = '2026-10-21T10:00:00Z';
const servers: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function bodyFor(provider: string) {
  return provider === 'github' ? {
    action: 'opened', repository: { full_name: 'org/repo' },
    pull_request: { number: 1, title: 'A PR', html_url: 'https://github.com/org/repo/pull/1',
      user: { login: 'diego' }, state: 'open', created_at: DATE, updated_at: DATE },
  } : {
    action: 'update', type: 'Issue', createdAt: DATE, webhookTimestamp: Date.now(),
    data: { id: 'issue-id', identifier: 'PROJ-1', title: 'A task', url: 'https://linear.app/team/issue/PROJ-1',
      state: { name: 'In Progress', type: 'started' }, assignee: { email: 'diego@example.com' }, updatedAt: DATE },
  };
}

function createRoute(provider: string, onEvent: (events: StatusEvent[]) => void | Promise<void> = () => {}) {
  const server = Fastify();
  servers.push(server);
  if (provider === 'github') {
    new GitHubProvider({ config: { webhookSecret: SECRET }, username: 'diego', onEvent }).registerRoutes(server);
  } else {
    new LinearProvider({ config: { webhookSecret: SECRET }, userEmail: 'diego@example.com', onEvent }).registerRoutes(server);
  }
  server.post('/unrelated', (request) => ({ parsed: typeof request.body === 'object' && !Buffer.isBuffer(request.body) }));
  return server;
}

function signedRequest(provider: string, raw: string, signature?: string) {
  const digest = createHmac('sha256', SECRET).update(raw).digest('hex');
  return {
    method: 'POST' as const, url: `/webhooks/${provider}`,
    headers: {
      'content-type': 'application/json',
      ...(provider === 'github' ? {
        'x-github-event': 'pull_request', 'x-hub-signature-256': signature ?? `sha256=${digest}`,
      } : { 'linear-signature': signature ?? digest }),
    }, payload: raw,
  };
}

describe.each(['github', 'linear'])('%s webhook transport', (provider) => {
  it('verifies exact raw bytes including whitespace', async () => {
    const accepted: StatusEvent[] = [];
    const server = createRoute(provider, (events) => { accepted.push(...events); });
    const response = await server.inject(signedRequest(provider, JSON.stringify(bodyFor(provider), null, 2)));
    expect(response.statusCode).toBe(200);
    expect(accepted).toHaveLength(1);
  });

  it('leaves JSON parsing unchanged on unrelated routes', async () => {
    const server = createRoute(provider);
    const response = await server.inject({ method: 'POST', url: '/unrelated', payload: { value: 1 } });
    expect(response.json()).toEqual({ parsed: true });
  });

  it.each(['sha256=wrong', ''])('rejects an invalid or missing signature (%s)', async (signature) => {
    const server = createRoute(provider);
    expect((await server.inject(signedRequest(provider, JSON.stringify(bodyFor(provider)), signature))).statusCode).toBe(401);
  });

  it('checks authentication before parsing malformed JSON', async () => {
    const server = createRoute(provider);
    expect((await server.inject(signedRequest(provider, '{broken', 'invalid'))).statusCode).toBe(401);
  });

  it.each(['{"action":', '{"action":"opened","type":"Issue"}', 'null', '[]'])('rejects signed malformed payload %s', async (raw) => {
    const server = createRoute(provider);
    expect((await server.inject(signedRequest(provider, raw))).statusCode).toBe(400);
  });

  it('acknowledges only after an asynchronous callback finishes', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let accepted = false;
    const server = createRoute(provider, async () => { entered(); await pending; accepted = true; });
    let acknowledged = false;
    const response = server.inject(signedRequest(provider, JSON.stringify(bodyFor(provider)))).then((result) => {
      acknowledged = true;
      return result;
    });
    await started;
    expect(accepted).toBe(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const acknowledgedEarly = acknowledged;
    release();
    expect(acknowledgedEarly).toBe(false);
    expect((await response).statusCode).toBe(200);
    expect(accepted).toBe(true);
  });

  it('returns 500 when durable event acceptance rejects', async () => {
    const server = createRoute(provider, async () => { throw new Error('Persistence unavailable'); });
    expect((await server.inject(signedRequest(provider, JSON.stringify(bodyFor(provider))))).statusCode).toBe(500);
  });
});

describe('Linear delivery timestamps', () => {
  it('accepts a legitimate delayed retry', async () => {
    const server = createRoute('linear');
    const payload = { ...bodyFor('linear'), webhookTimestamp: Date.now() - 7 * 60 * 60 * 1000 };
    expect((await server.inject(signedRequest('linear', JSON.stringify(payload)))).statusCode).toBe(200);
  });

  it.each([Date.now() + 60 * 60 * 1000, Date.now() - 48 * 60 * 60 * 1000, -1])('rejects an unreasonable timestamp %s', async (webhookTimestamp) => {
    const server = createRoute('linear');
    const payload = { ...bodyFor('linear'), webhookTimestamp };
    expect((await server.inject(signedRequest('linear', JSON.stringify(payload)))).statusCode).toBe(400);
  });
});
