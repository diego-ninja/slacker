// src/providers/linear.ts
// ABOUTME: Linear webhook provider for issue events
// ABOUTME: Parses Linear webhooks and produces StatusEvents based on issue state

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Provider, ProviderConfig } from './provider.js';
import type { StatusEvent } from '../types.js';

export interface LinearProviderOptions {
  config: ProviderConfig;
  userEmail: string;
  onEvent: (events: StatusEvent[]) => void;
}

export class LinearProvider implements Provider {
  readonly name = 'linear';

  constructor(private options: LinearProviderOptions) {}

  registerRoutes(server: FastifyInstance): void {
    server.post('/webhooks/linear', async (request, reply) => {
      if (!this.verifySignature(request)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const payload = request.body as any;
      const events = parseLinearEvent(payload, this.options.userEmail);

      if (events.length > 0) {
        this.options.onEvent(events);
      }

      return reply.status(200).send({ ok: true });
    });
  }

  private verifySignature(request: FastifyRequest): boolean {
    const signature = request.headers['linear-signature'] as string;
    if (!signature) return false;

    const body = JSON.stringify(request.body);
    const expected = createHmac('sha256', this.options.config.webhookSecret)
      .update(body)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

const STATE_MAP: Record<string, string> = {
  'in progress': 'linear:issue:in_progress',
  'in review': 'linear:issue:in_review',
  'todo': 'linear:issue:todo',
  'backlog': 'linear:issue:backlog',
};

const INACTIVE_STATES = ['done', 'canceled', 'cancelled', 'archived'];

export function parseLinearEvent(
  payload: any,
  userEmail: string
): StatusEvent[] {
  if (payload.type !== 'Issue') return [];

  const data = payload.data;
  const assignee = data.assignee;

  if (!assignee || assignee.email !== userEmail) return [];

  const now = new Date();
  const stateName = data.state?.name?.toLowerCase() || '';
  const isInactive = INACTIVE_STATES.includes(stateName);

  const eventType = STATE_MAP[stateName] || 'linear:issue:other';

  return [{
    id: `linear:issue:${data.id}`,
    provider: 'linear',
    type: eventType,
    active: !isInactive,
    context: {
      title: data.title,
      url: data.url,
      identifier: data.identifier,
      state: data.state?.name,
    },
    createdAt: now,
    updatedAt: now,
  }];
}
