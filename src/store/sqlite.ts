// ABOUTME: SQLite implementation of the StateStore interface
// ABOUTME: Persists StatusEvents with automatic schema initialization

import Database from 'better-sqlite3';
import type { StateStore } from './store.js';
import type { StatusEvent } from '../types.js';

export class SQLiteStore implements StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        context TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_active ON events(active);
      CREATE INDEX IF NOT EXISTS idx_provider ON events(provider);
    `);
  }

  upsert(event: StatusEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, provider, type, active, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        type = excluded.type,
        active = excluded.active,
        context = excluded.context,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      event.id,
      event.provider,
      event.type,
      event.active ? 1 : 0,
      JSON.stringify(event.context),
      event.createdAt.toISOString(),
      event.updatedAt.toISOString()
    );
  }

  getActive(): StatusEvent[] {
    const stmt = this.db.prepare('SELECT * FROM events WHERE active = 1');
    const rows = stmt.all() as DatabaseRow[];
    return rows.map(this.rowToEvent);
  }

  get(id: string): StatusEvent | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id) as DatabaseRow | undefined;
    return row ? this.rowToEvent(row) : null;
  }

  deactivate(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE events SET active = 0, updated_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  prune(olderThan: Date): number {
    const stmt = this.db.prepare(`
      DELETE FROM events WHERE active = 0 AND updated_at < ?
    `);
    const result = stmt.run(olderThan.toISOString());
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private rowToEvent(row: DatabaseRow): StatusEvent {
    return {
      id: row.id,
      provider: row.provider,
      type: row.type,
      active: row.active === 1,
      context: JSON.parse(row.context),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

interface DatabaseRow {
  id: string;
  provider: string;
  type: string;
  active: number;
  context: string;
  created_at: string;
  updated_at: string;
}
