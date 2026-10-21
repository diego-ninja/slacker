// ABOUTME: Tests for SQLite state store implementation
// ABOUTME: Validates CRUD operations and event lifecycle

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from './sqlite.js';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    const event = createEvent({ updatedAt: new Date('2026-10-21T10:00:00.000Z') });
    store.upsert(event);

    const updated = createEvent({
      context: { title: 'Updated PR', url: 'https://github.com/test', identifier: '#123' },
      updatedAt: new Date('2026-10-21T10:01:00.000Z'),
    });
    store.upsert(updated);

    const retrieved = store.get('github:pr:123');
    expect(retrieved?.context.title).toBe('Updated PR');
  });

  it('ignores an older snapshot delivered after a newer update', () => {
    const latest = createEvent({ updatedAt: new Date('2026-10-21T10:02:00.000Z') });
    store.upsert(latest);
    store.upsert(createEvent({
      active: false,
      updatedAt: new Date('2026-10-21T10:01:00.000Z'),
      context: { title: 'Delayed title', url: 'https://github.com/test', identifier: '#123' },
    }));

    expect(store.get(latest.id)).toEqual(latest);
  });

  it('does not replace a snapshot with a repeated source version', () => {
    const latest = createEvent({ updatedAt: new Date('2026-10-21T10:02:00.000Z') });
    store.upsert(latest);
    store.upsert({ ...latest, context: { ...latest.context, title: 'Repeated delivery' } });

    expect(store.get(latest.id)).toEqual(latest);
  });

  it('favors an inactive tombstone when the source timestamps are equal', () => {
    const latest = createEvent({ updatedAt: new Date('2026-10-21T10:02:00.000Z') });
    store.upsert(latest);
    store.upsert({ ...latest, active: false });

    expect(store.get(latest.id)).toEqual({ ...latest, active: false });
    expect(store.getActive()).toEqual([]);
  });

  it('does not reactivate an inactive tombstone with the same source timestamp', () => {
    const tombstone = createEvent({ active: false, updatedAt: new Date('2026-10-21T10:02:00.000Z') });
    store.upsert(tombstone);
    store.upsert({ ...tombstone, active: true });

    expect(store.get(tombstone.id)).toEqual(tombstone);
    expect(store.getActive()).toEqual([]);
  });

  it('keeps an inactive tombstone when an older active delivery arrives', () => {
    const tombstone = createEvent({ active: false, updatedAt: new Date('2026-10-21T10:02:00.000Z') });
    store.upsert(tombstone);
    store.upsert(createEvent({ active: true, updatedAt: new Date('2026-10-21T10:01:00.000Z') }));

    expect(store.get(tombstone.id)).toEqual(tombstone);
    expect(store.getActive()).toEqual([]);
  });

  it('reactivates a tombstone only for a newer source version and preserves creation time', () => {
    const createdAt = new Date('2026-10-20T08:00:00.000Z');
    store.upsert(createEvent({
      createdAt,
      active: false,
      updatedAt: new Date('2026-10-21T10:00:00.000Z'),
    }));
    store.upsert(createEvent({
      createdAt: new Date('2026-10-21T10:01:00.000Z'),
      active: true,
      updatedAt: new Date('2026-10-21T10:01:00.000Z'),
    }));

    expect(store.get('github:pr:123')).toMatchObject({
      active: true,
      createdAt,
      updatedAt: new Date('2026-10-21T10:01:00.000Z'),
    });
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

  it('migrates receipt timestamps to source versions once without losing persisted events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slacker-migration-'));
    const path = join(directory, 'state.db');
    const context = { title: 'Persisted PR', url: 'https://github.com/org/repo/pull/123', identifier: '#123' };
    const receiptTime = '2026-10-21T12:00:00.000Z';
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, context TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    legacy.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'github:pr:123', 'github', 'pr:review_requested', 1, JSON.stringify(context), receiptTime, receiptTime,
    );
    legacy.close();
    let migrated: SQLiteStore | undefined;
    try {
      migrated = new SQLiteStore(path);
      expect(migrated.get('github:pr:123')).toEqual(createEvent({
        context, createdAt: new Date(receiptTime), updatedAt: new Date(receiptTime),
      }));
      const authoritative = createEvent({
        active: false,
        context,
        createdAt: new Date('2026-10-21T09:00:00.000Z'),
        updatedAt: new Date('2026-10-21T11:00:00.000Z'),
      });
      migrated.upsert(authoritative);
      expect(migrated.get(authoritative.id)).toEqual(authoritative);
      migrated.close();

      migrated = new SQLiteStore(path);
      migrated.upsert({ ...authoritative, active: true, updatedAt: new Date('2026-10-21T10:00:00.000Z') });
      expect(migrated.get(authoritative.id)).toEqual(authoritative);
      expect(migrated.getActive()).toEqual([]);
      migrated.upsert({
        ...authoritative, active: true,
        createdAt: new Date('2026-10-21T12:30:00.000Z'),
        updatedAt: new Date('2026-10-21T13:00:00.000Z'),
      });
      expect(migrated.get(authoritative.id)).toEqual({
        ...authoritative, active: true, updatedAt: new Date('2026-10-21T13:00:00.000Z'),
      });
    } finally {
      migrated?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
