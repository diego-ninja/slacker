// ABOUTME: Tests for SQLite state store implementation
// ABOUTME: Validates CRUD operations and event lifecycle

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from './sqlite.js';
import { unlinkSync, existsSync } from 'fs';
import type { StatusEvent } from '../types.js';

const TEST_DB = 'test-slacker.db';

function createEvent(overrides: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: 'github:pr:123',
    provider: 'github',
    type: 'pr:review_requested',
    active: true,
    context: {
      title: 'Test PR',
      url: 'https://github.com/test',
      identifier: '#123',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = new SQLiteStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  it('inserts and retrieves an event', () => {
    const event = createEvent();
    store.upsert(event);

    const retrieved = store.get('github:pr:123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('github:pr:123');
    expect(retrieved?.provider).toBe('github');
    expect(retrieved?.context.title).toBe('Test PR');
  });

  it('updates existing event on upsert', () => {
    const event = createEvent();
    store.upsert(event);

    const updated = createEvent({
      context: { title: 'Updated PR', url: 'https://github.com/test', identifier: '#123' },
    });
    store.upsert(updated);

    const retrieved = store.get('github:pr:123');
    expect(retrieved?.context.title).toBe('Updated PR');
  });

  it('returns only active events', () => {
    store.upsert(createEvent({ id: 'event-1', active: true }));
    store.upsert(createEvent({ id: 'event-2', active: false }));
    store.upsert(createEvent({ id: 'event-3', active: true }));

    const active = store.getActive();
    expect(active).toHaveLength(2);
    expect(active.map(e => e.id).sort()).toEqual(['event-1', 'event-3']);
  });

  it('deactivates an event', () => {
    store.upsert(createEvent({ id: 'event-1', active: true }));

    store.deactivate('event-1');

    const event = store.get('event-1');
    expect(event?.active).toBe(false);
  });

  it('prunes old inactive events', () => {
    const oldDate = new Date('2020-01-01');
    const recentDate = new Date();

    store.upsert(createEvent({ id: 'old-inactive', active: false, updatedAt: oldDate }));
    store.upsert(createEvent({ id: 'old-active', active: true, updatedAt: oldDate }));
    store.upsert(createEvent({ id: 'recent-inactive', active: false, updatedAt: recentDate }));

    const pruned = store.prune(new Date('2021-01-01'));

    expect(pruned).toBe(1);
    expect(store.get('old-inactive')).toBeNull();
    expect(store.get('old-active')).not.toBeNull();
    expect(store.get('recent-inactive')).not.toBeNull();
  });
});
