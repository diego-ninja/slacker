// ABOUTME: Tests for core type definitions and validation
// ABOUTME: Validates StatusEvent schema and type guards

import { describe, it, expect } from 'vitest';
import { StatusEventSchema, type StatusEvent } from './types.js';

describe('StatusEvent', () => {
  it('validates a complete status event', () => {
    const event: StatusEvent = {
      id: 'github:pr:123',
      provider: 'github',
      type: 'pr:review_requested',
      active: true,
      context: {
        title: 'Fix authentication bug',
        url: 'https://github.com/org/repo/pull/123',
        identifier: '#123',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = StatusEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('rejects event without required fields', () => {
    const event = {
      id: 'github:pr:123',
      provider: 'github',
    };

    const result = StatusEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('allows extra context fields', () => {
    const event: StatusEvent = {
      id: 'linear:issue:ABC-123',
      provider: 'linear',
      type: 'linear:issue:in_progress',
      active: true,
      context: {
        title: 'Implement feature',
        url: 'https://linear.app/team/issue/ABC-123',
        identifier: 'ABC-123',
        priority: 'high',
        assignee: 'diego',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = StatusEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});
