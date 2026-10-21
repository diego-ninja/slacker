// ABOUTME: Interface definition for webhook providers
// ABOUTME: Defines contract that GitHub, Linear, and future providers must implement

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StatusEvent } from '../types.js';

export interface Provider {
  readonly name: string;

  registerRoutes(server: FastifyInstance): void;
}

export interface ProviderConfig {
  webhookSecret: string;
}

export type EventHandler = (events: StatusEvent[]) => void | Promise<void>;

export const SourceTimestampSchema = z.string().datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid source timestamp');
