// src/server.test.ts
// ABOUTME: Tests for HTTP server setup and health endpoints
// ABOUTME: Validates server initialization and basic routes

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from './server.js';
import type { Config } from './config.js';

const testConfig: Config = {
  slack: { token: 'test-token' },
  providers: {},
  rules: [],
  defaultStatus: { emoji: '', text: '' },
};

describe('Server', () => {
  it('responds to health check', async () => {
    const server = createServer(testConfig, ':memory:');

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await server.close();
  });

  it('responds to status endpoint', async () => {
    const server = createServer(testConfig, ':memory:');

    const response = await server.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('activeEvents');
    expect(body).toHaveProperty('currentStatus');

    await server.close();
  });
});
