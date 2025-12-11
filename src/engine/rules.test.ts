// src/engine/rules.test.ts
// ABOUTME: Tests for the rule evaluation engine
// ABOUTME: Validates priority-based event matching and status resolution

import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rules.js';
import type { StatusEvent } from '../types.js';
import type { Rule, StatusTemplate } from '../config.js';

function createEvent(overrides: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: 'test:event:1',
    provider: 'test',
    type: 'test:type',
    active: true,
    context: {
      title: 'Test Event',
      url: 'https://example.com',
      identifier: 'TEST-1',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RuleEngine', () => {
  const rules: Rule[] = [
    { event: 'pr:changes_requested', status: { emoji: ':warning:', text: 'Changes on ${identifier}' } },
    { event: 'pr:review_requested', status: { emoji: ':eyes:', text: 'Reviewing ${identifier}' } },
    { event: 'issue:assigned', status: { emoji: ':memo:', text: 'Working on ${identifier}' } },
  ];

  const defaultStatus: StatusTemplate = { emoji: '', text: '' };

  it('matches first rule by priority', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const events = [
      createEvent({ id: '1', type: 'issue:assigned' }),
      createEvent({ id: '2', type: 'pr:review_requested' }),
    ];

    const status = engine.evaluate(events);

    expect(status.emoji).toBe(':eyes:');
    expect(status.text).toBe('Reviewing TEST-1');
  });

  it('returns default status when no events', () => {
    const engine = new RuleEngine(rules, defaultStatus);

    const status = engine.evaluate([]);

    expect(status.emoji).toBe('');
    expect(status.text).toBe('');
  });

  it('returns default status when no rules match', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const events = [createEvent({ type: 'unknown:type' })];

    const status = engine.evaluate(events);

    expect(status.emoji).toBe('');
    expect(status.text).toBe('');
  });

  it('uses context from the matched event', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const events = [
      createEvent({
        type: 'pr:review_requested',
        context: { title: 'Fix auth', url: 'https://gh.com', identifier: '#456' },
      }),
    ];

    const status = engine.evaluate(events);

    expect(status.text).toBe('Reviewing #456');
  });

  it('skips inactive events', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const events = [
      createEvent({ type: 'pr:changes_requested', active: false }),
      createEvent({ type: 'issue:assigned', active: true }),
    ];

    const status = engine.evaluate(events);

    expect(status.emoji).toBe(':memo:');
  });
});
