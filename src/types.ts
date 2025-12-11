// ABOUTME: Core type definitions for Slacker
// ABOUTME: Defines StatusEvent schema and related types used across all providers

import { z } from 'zod';

export const StatusEventSchema = z.object({
  id: z.string(),
  provider: z.string(),
  type: z.string(),
  active: z.boolean(),
  context: z.object({
    title: z.string(),
    url: z.string(),
    identifier: z.string(),
  }).passthrough(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type StatusEvent = z.infer<typeof StatusEventSchema>;

export interface SlackStatus {
  emoji: string;
  text: string;
}
