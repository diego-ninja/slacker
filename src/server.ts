// src/server.ts
// ABOUTME: HTTP server setup with provider registration
// ABOUTME: Initializes Fastify, registers routes, and coordinates components

import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import type { WebClient } from '@slack/web-api';
import { ConfigSchema, type Config } from './config.js';
import { SQLiteStore } from './store/sqlite.js';
import { RuleEngine } from './engine/rules.js';
import { SlackClient, formatStatus } from './slack/client.js';
import { StatusSync } from './slack/sync.js';
import { createSlackConnection } from './slack/connection.js';
import { GitHubProvider } from './providers/github.js';
import { LinearProvider } from './providers/linear.js';
import { StatusEventSchema, type StatusEvent } from './types.js';
import type { Provider } from './providers/provider.js';

export interface ServerOptions {
  webClient?: WebClient;
  logger?: boolean;
  syncIntervalMs?: number;
}

export function createServer(input: Config, dbPath: string, options: ServerOptions = {}): FastifyInstance {
  const config = ConfigSchema.parse(input);
  const server = Fastify({ logger: options.logger ?? { redact: ['req.headers.authorization'] } });
  const store = new SQLiteStore(dbPath);
  const ruleEngine = new RuleEngine(config.rules, config.defaultStatus);
  const slackClient = new SlackClient(options.webClient ?? createSlackConnection(config.slack.token));
  const desiredStatus = () => formatStatus(ruleEngine.evaluate(store.getActive()));
  const sync = new StatusSync(desiredStatus, slackClient, (code) => {
    server.log.error({ code }, 'Slack status update failed');
  });
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;

  const handleEvent = async (events: StatusEvent[]) => {
    const validated = events.map((event) => StatusEventSchema.parse(event));
    for (const event of validated) {
      store.upsert(event);
    }
    void sync.sync();
  };

  const providers: Provider[] = [];

  if (config.providers.github) {
    providers.push(new GitHubProvider({
      config: config.providers.github,
      username: config.providers.github.username,
      onEvent: handleEvent,
    }));
  }

  if (config.providers.linear) {
    providers.push(new LinearProvider({
      config: config.providers.linear,
      userEmail: config.providers.linear.userEmail,
      onEvent: handleEvent,
    }));
  }

  for (const provider of providers) {
    provider.registerRoutes(server);
  }

  server.get('/health', async () => ({ ok: true }));

  if (config.statusToken) {
    const expected = Buffer.from(`Bearer ${config.statusToken}`);
    server.get('/status', async (request, reply) => {
      const provided = Buffer.from(request.headers.authorization ?? '');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'Unauthorized' });
      }
      return {
        activeEvents: store.getActive(),
        currentStatus: desiredStatus(),
        lastAppliedStatus: slackClient.getStatus(),
        pending: sync.isPending(),
        lastError: sync.getLastError(),
      };
    });
  }

  server.addHook('onReady', async () => {
    void sync.sync();
    recoveryTimer = setInterval(() => { void sync.sync(); }, options.syncIntervalMs ?? 30000);
    recoveryTimer.unref();
  });

  server.addHook('onClose', async () => {
    clearInterval(recoveryTimer);
    await sync.close();
    store.close();
  });

  return server;
}
