// ABOUTME: Interface definition for webhook providers
// ABOUTME: Defines contract that GitHub, Linear, and future providers must implement

import type { FastifyInstance } from 'fastify';
import type { StatusEvent } from '../types.js';

export interface Provider {
  readonly name: string;

  registerRoutes(server: FastifyInstance): void;
}

export interface ProviderConfig {
  webhookSecret: string;
}
