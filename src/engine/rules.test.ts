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

  it('selects the newest source update among events matching the same rule', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const older = createEvent({
      id: 'a',
      type: 'pr:review_requested',
      updatedAt: new Date('2026-10-21T10:00:00.000Z'),
      context: { title: 'Older', url: 'https://example.com/older', identifier: '#1' },
    });
    const newer = createEvent({
      id: 'z',
      type: 'pr:review_requested',
      updatedAt: new Date('2026-10-21T10:01:00.000Z'),
      context: { title: 'Newer', url: 'https://example.com/newer', identifier: '#2' },
    });

    expect(engine.evaluate([older, newer]).text).toBe('Reviewing #2');
    expect(engine.evaluate([newer, older]).text).toBe('Reviewing #2');
  });

  it('uses ascending event IDs for equal source timestamps regardless of input order', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const timestamp = new Date('2026-10-21T10:00:00.000Z');
    const first = createEvent({
      id: 'github:pr:org/repo:1',
      type: 'pr:review_requested',
      updatedAt: timestamp,
      context: { title: 'First', url: 'https://example.com/first', identifier: '#1' },
    });
    const second = createEvent({
      id: 'github:pr:org/repo:2',
      type: 'pr:review_requested',
      updatedAt: timestamp,
      context: { title: 'Second', url: 'https://example.com/second', identifier: '#2' },
    });

    expect(engine.evaluate([second, first]).text).toBe('Reviewing #1');
    expect(engine.evaluate([first, second]).text).toBe('Reviewing #1');
  });

  it('keeps rule priority ahead of source recency', () => {
    const engine = new RuleEngine(rules, defaultStatus);
    const events = [
      createEvent({ type: 'issue:assigned', updatedAt: new Date('2026-10-21T10:01:00.000Z') }),
      createEvent({ type: 'pr:review_requested', updatedAt: new Date('2026-10-21T10:00:00.000Z') }),
    ];

    expect(engine.evaluate(events).text).toBe('Reviewing TEST-1');
  });
});
