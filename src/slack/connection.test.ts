// ABOUTME: Contract integration test for an absolute Slack HTTP request deadline.
// ABOUTME: Keeps a local response active to distinguish total duration from inactivity timeouts.

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { LogLevel } from '@slack/web-api';
import { createSlackConnection } from './connection.js';

describe('Slack connection contract integration', () => {
  it('bounds request duration even when response bytes keep arriving', async () => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    const warnings: unknown[][] = [];
    const errors: unknown[][] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (...messages: unknown[]) => { warnings.push(messages); },
      error: (...messages: unknown[]) => { errors.push(messages); },
      getLevel: () => LogLevel.ERROR,
      setLevel: () => {},
      setName: () => {},
    };
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"ok":true,"padding":"');
      const interval = setInterval(() => response.write(' '), 20);
      intervals.push(interval);
      response.on('close', () => clearInterval(interval));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected local TCP address');
    const client = createSlackConnection('dummy-slack-token', {
      slackApiUrl: `http://127.0.0.1:${address.port}/api/`,
      logger,
      timeout: 100,
    });
    const safetyCutoff = setTimeout(() => server.closeAllConnections(), 600);
    try {
      const startedAt = Date.now();
      await expect(client.users.profile.set({ profile: { status_emoji: ':eyes:', status_text: 'Reviewing' } }))
        .rejects.toBeDefined();

      expect(Date.now() - startedAt).toBeLessThan(400);
      expect(warnings.some((messages) => messages[0] === 'http request failed'
        && /canceled|timeout|aborted/i.test(String(messages[1])))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      clearTimeout(safetyCutoff);
      for (const interval of intervals) clearInterval(interval);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
