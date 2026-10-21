// ABOUTME: Authenticates raw webhook bytes before parsing provider payloads
// ABOUTME: Encapsulates JSON parsing and awaits durable event acceptance

import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { StatusEvent } from '../types.js';
import type { EventHandler } from './provider.js';

interface WebhookOptions {
  path: string;
  secret: string;
  signatureHeader: string;
  signaturePrefix?: string;
  parse: (payload: unknown, request: FastifyRequest) => StatusEvent[];
  onEvent: EventHandler;
}

export function registerWebhook(server: FastifyInstance, options: WebhookOptions): void {
  server.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    scope.post<{ Body: Buffer }>(options.path, async (request, reply) => {
      const signature = request.headers[options.signatureHeader];
      const prefix = options.signaturePrefix ?? '';
      if (typeof signature !== 'string' || !signature.startsWith(prefix)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
      const digest = signature.slice(prefix.length);
      if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
      const expected = createHmac('sha256', options.secret).update(request.body).digest();
      if (!timingSafeEqual(Buffer.from(digest, 'hex'), expected)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      let events: StatusEvent[];
      try {
        const payload: unknown = JSON.parse(request.body.toString('utf8'));
        z.object({}).parse(payload);
        events = options.parse(payload, request);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid payload' });
        }
        throw error;
      }

      if (events.length > 0) await options.onEvent(events);
      return reply.code(200).send({ ok: true });
    });
  });
}
