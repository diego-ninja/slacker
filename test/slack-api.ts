// ABOUTME: Local Slack HTTP contract fixture using the real Web API SDK.
// ABOUTME: Records profile requests and controls acknowledgements without external HTTP.

import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebClient, LogLevel } from '@slack/web-api';

export interface ProfileRequest {
  path: string;
  profile: { status_emoji: string; status_text: string };
  authenticated: boolean;
}

interface ResponsePlan {
  body: Record<string, unknown>;
  gate?: Promise<void>;
  statusCode?: number;
  headers?: Record<string, string>;
}

export async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for local contract state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function createSlackApi() {
  const requests: ProfileRequest[] = [];
  const responses: ResponsePlan[] = [];
  const releases: (() => void)[] = [];
  const logs: { level: string; messages: unknown[] }[] = [];
  let level = LogLevel.ERROR;
  const logger = {
    debug: (...messages: unknown[]) => { logs.push({ level: 'debug', messages }); },
    info: (...messages: unknown[]) => { logs.push({ level: 'info', messages }); },
    warn: (...messages: unknown[]) => { logs.push({ level: 'warn', messages }); },
    error: (...messages: unknown[]) => { logs.push({ level: 'error', messages }); },
    getLevel: () => level,
    setLevel: (value: LogLevel) => { level = value; },
    setName: () => {},
  };

  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const profile = JSON.parse(fields.get('profile') || '{}') as ProfileRequest['profile'];
    requests.push({
      path: request.url || '',
      profile,
      authenticated: request.headers.authorization === 'Bearer dummy-slack-token',
    });
    const plan = responses.shift() || { body: { ok: true } };
    await plan.gate;
    if (response.destroyed) return;
    response.writeHead(plan.statusCode ?? 200, { 'content-type': 'application/json', ...plan.headers });
    response.end(JSON.stringify(plan.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local TCP address');

  const client = new WebClient('dummy-slack-token', {
    slackApiUrl: `http://127.0.0.1:${address.port}/api/`,
    retryConfig: { retries: 0 },
    timeout: 1000,
    rejectRateLimitedCalls: true,
    logger,
    requestInterceptor: (request) => {
      const url = new URL(request.url || '', request.baseURL);
      if (url.hostname !== '127.0.0.1') throw new Error('External HTTP is forbidden in contract tests');
      return request;
    },
  });

  return {
    client,
    requests,
    logs,
    enqueue(body: Record<string, unknown>) {
      responses.push({ body });
    },
    rateLimitNext(seconds: number) {
      responses.push({
        body: { ok: false, error: 'ratelimited' },
        statusCode: 429,
        headers: { 'retry-after': String(seconds) },
      });
    },
    holdNext(body: Record<string, unknown> = { ok: true }) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      releases.push(release);
      responses.push({ body, gate });
      return release;
    },
    releaseAll() {
      for (const release of releases) release();
    },
    async close() {
      for (const release of releases) release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

export type SlackApi = Awaited<ReturnType<typeof createSlackApi>>;
