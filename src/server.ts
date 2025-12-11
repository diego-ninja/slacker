// src/server.ts
// ABOUTME: HTTP server setup with provider registration
// ABOUTME: Initializes Fastify, registers routes, and coordinates components

import Fastify, { type FastifyInstance } from 'fastify';
import { WebClient } from '@slack/web-api';
import type { Config } from './config.js';
import { SQLiteStore } from './store/sqlite.js';
import { RuleEngine } from './engine/rules.js';
import { SlackClient } from './slack/client.js';
import { GitHubProvider } from './providers/github.js';
import { LinearProvider } from './providers/linear.js';
import type { StatusEvent } from './types.js';
import type { Provider } from './providers/provider.js';

export function createServer(config: Config, dbPath: string): FastifyInstance {
  const server = Fastify({ logger: true });
  const store = new SQLiteStore(dbPath);
  const ruleEngine = new RuleEngine(config.rules, config.defaultStatus);
  const slackClient = new SlackClient(new WebClient(config.slack.token));

  const handleEvent = async (events: StatusEvent[]) => {
    for (const event of events) {
      store.upsert(event);
    }
    const activeEvents = store.getActive();
    const status = ruleEngine.evaluate(activeEvents);
    await slackClient.setStatus(status);
  };

  const providers: Provider[] = [];

  if (config.providers.github) {
    providers.push(new GitHubProvider({
      config: config.providers.github,
      username: process.env.GITHUB_USERNAME || '',
      onEvent: handleEvent,
    }));
  }

  if (config.providers.linear) {
    providers.push(new LinearProvider({
      config: config.providers.linear,
      userEmail: process.env.LINEAR_USER_EMAIL || '',
      onEvent: handleEvent,
    }));
  }

  for (const provider of providers) {
    provider.registerRoutes(server);
  }

  server.get('/health', async () => ({ ok: true }));

  server.get('/status', async () => {
    const activeEvents = store.getActive();
    const currentStatus = ruleEngine.evaluate(activeEvents);
    return {
      activeEvents,
      currentStatus,
    };
  });

  server.addHook('onClose', () => {
    store.close();
  });

  return server;
}
