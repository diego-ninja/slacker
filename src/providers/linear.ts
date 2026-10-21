// ABOUTME: Receives Linear issue webhooks and derives assigned work state
// ABOUTME: Handles ownership, removal, archive, and semantic workflow states

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SourceTimestampSchema, type EventHandler, type Provider, type ProviderConfig } from './provider.js';
import { registerWebhook } from './webhook.js';
import type { StatusEvent } from '../types.js';

export interface LinearProviderOptions {
  config: ProviderConfig;
  userEmail: string;
  onEvent: EventHandler;
}

export class LinearProvider implements Provider {
  readonly name = 'linear';

  constructor(private options: LinearProviderOptions) {}

  registerRoutes(server: FastifyInstance): void {
    registerWebhook(server, {
      path: '/webhooks/linear', secret: this.options.config.webhookSecret, signatureHeader: 'linear-signature',
      parse: (payload) => {
        z.object({
          webhookTimestamp: z.number().int().positive().refine((timestamp) => {
            const age = Date.now() - timestamp;
            return age >= -5 * 60 * 1000 && age <= 24 * 60 * 60 * 1000;
          }, 'Unreasonable delivery timestamp'),
        }).parse(payload);
        return parseLinearEvent(payload, this.options.userEmail);
      },
      onEvent: this.options.onEvent,
    });
  }
}

const LinearEventSchema = z.object({
  type: z.string(),
  action: z.enum(['create', 'update', 'remove']),
  createdAt: SourceTimestampSchema.optional(),
  data: z.object({
    id: z.string().min(1), identifier: z.string().min(1), title: z.string(), url: z.string().url(),
    createdAt: SourceTimestampSchema.optional(), updatedAt: SourceTimestampSchema.optional(),
    archivedAt: SourceTimestampSchema.nullable().optional(),
    state: z.object({ name: z.string(), type: z.string().optional() }).nullable().optional(),
    assignee: z.object({ email: z.string().email() }).nullable().optional(),
  }),
  updatedFrom: z.object({ assigneeId: z.string().nullable().optional() }).optional(),
}).superRefine((event, context) => {
  if (!event.createdAt && (event.action === 'remove' || !event.data.updatedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing source timestamp', path: ['createdAt'] });
  }
});

const STATE_TYPES: Record<string, string> = {
  started: 'in_progress', unstarted: 'todo', backlog: 'backlog', completed: 'done', canceled: 'canceled',
};
const STATE_NAMES: Record<string, string> = {
  'in progress': 'in_progress', 'in review': 'in_review', todo: 'todo', backlog: 'backlog',
  done: 'done', canceled: 'canceled', cancelled: 'canceled', archived: 'archived',
};

export function parseLinearEvent(payload: unknown, userEmail: string): StatusEvent[] {
  const { type } = z.object({ type: z.string() }).parse(payload);
  if (type !== 'Issue') return [];
  const event = LinearEventSchema.parse(payload);
  const { data } = event;
  const isAssigned = data.assignee?.email === userEmail;
  const ownershipChanged = typeof event.updatedFrom?.assigneeId === 'string';
  if (!isAssigned && !ownershipChanged && event.action !== 'remove') return [];

  const name = data.state?.name.trim().toLowerCase() ?? '';
  const semantic = data.state?.type;
  const state = semantic
    ? (semantic === 'started' && name === 'in review' ? 'in_review' : STATE_TYPES[semantic] ?? 'other')
    : STATE_NAMES[name] ?? 'other';
  const inactive = !isAssigned || event.action === 'remove' || Boolean(data.archivedAt) || semantic === 'duplicate'
    || ['done', 'canceled', 'archived'].includes(state);
  const updatedAt = new Date(SourceTimestampSchema.parse(event.createdAt ?? data.updatedAt));

  return [{
    id: `linear:issue:${data.id}`, provider: 'linear', type: `linear:issue:${state}`, active: !inactive,
    context: { title: data.title, url: data.url, identifier: data.identifier, state: data.state?.name },
    createdAt: data.createdAt ? new Date(data.createdAt) : updatedAt, updatedAt,
  }];
}
