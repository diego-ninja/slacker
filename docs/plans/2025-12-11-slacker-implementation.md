# Slacker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Slack status synchronizer that updates status based on GitHub and Linear webhook events.

**Architecture:** Modular provider system where each source (GitHub, Linear) implements a common interface. Events are normalized to `StatusEvent`, stored in SQLite, and evaluated by a rule engine that determines which status to show based on configurable priorities.

**Tech Stack:** TypeScript, Node.js, Fastify, better-sqlite3, Zod, @slack/web-api

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "slacker",
  "version": "0.1.0",
  "description": "Slack status synchronizer with GitHub and Linear",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "@slack/web-api": "^7.8.0",
    "better-sqlite3": "^11.7.0",
    "fastify": "^5.2.1",
    "yaml": "^2.7.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
*.db
.env
slacker.config.yaml
```

**Step 4: Install dependencies**

Run: `npm install`
Expected: Dependencies installed, package-lock.json created

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "chore: initial project setup"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/types.ts`
- Create: `src/types.test.ts`

**Step 1: Write the test for StatusEvent type**

```typescript
// src/types.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/types.test.ts`
Expected: FAIL - Cannot find module './types.js'

**Step 3: Write the types implementation**

```typescript
// src/types.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/types.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add core StatusEvent type with Zod schema"
```

---

## Task 3: Configuration Schema

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`
- Create: `slacker.config.example.yaml`

**Step 1: Write the test for config loading**

```typescript
// src/config.test.ts
// ABOUTME: Tests for configuration loading and validation
// ABOUTME: Ensures config schema catches invalid configurations

import { describe, it, expect } from 'vitest';
import { ConfigSchema, type Config } from './config.js';

describe('Config', () => {
  it('validates a complete config', () => {
    const config: Config = {
      slack: {
        token: 'xoxb-test-token',
      },
      providers: {
        github: {
          webhookSecret: 'github-secret',
        },
        linear: {
          webhookSecret: 'linear-secret',
        },
      },
      rules: [
        {
          event: 'pr:review_requested',
          status: {
            emoji: ':eyes:',
            text: 'Reviewing ${identifier}',
          },
        },
      ],
      defaultStatus: {
        emoji: '',
        text: '',
      },
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('requires slack token', () => {
    const config = {
      providers: {},
      rules: [],
      defaultStatus: { emoji: '', text: '' },
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('requires at least defaultStatus', () => {
    const config = {
      slack: { token: 'token' },
      providers: {},
      rules: [],
    };

    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/config.test.ts`
Expected: FAIL - Cannot find module './config.js'

**Step 3: Write the config implementation**

```typescript
// src/config.ts
// ABOUTME: Configuration schema and loader for Slacker
// ABOUTME: Parses YAML config file with environment variable interpolation

import { z } from 'zod';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

const StatusTemplateSchema = z.object({
  emoji: z.string(),
  text: z.string(),
});

const RuleSchema = z.object({
  event: z.string(),
  status: StatusTemplateSchema,
});

const ProviderConfigSchema = z.object({
  webhookSecret: z.string(),
});

export const ConfigSchema = z.object({
  slack: z.object({
    token: z.string(),
  }),
  providers: z.record(ProviderConfigSchema).default({}),
  rules: z.array(RuleSchema).default([]),
  defaultStatus: StatusTemplateSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type StatusTemplate = z.infer<typeof StatusTemplateSchema>;

function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{(\w+)\}/g, (_, name) => {
    return process.env[name] ?? '';
  });
}

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const interpolated = interpolateEnvVars(raw);
  const parsed = parseYaml(interpolated);
  return ConfigSchema.parse(parsed);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/config.test.ts`
Expected: PASS - All tests green

**Step 5: Create example config file**

```yaml
# slacker.config.example.yaml
# Copy to slacker.config.yaml and fill in your values

slack:
  token: ${SLACK_TOKEN}

providers:
  github:
    webhookSecret: ${GITHUB_WEBHOOK_SECRET}
  linear:
    webhookSecret: ${LINEAR_WEBHOOK_SECRET}

rules:
  - event: "pr:authored:changes_requested"
    status:
      emoji: ":warning:"
      text: "Atendiendo cambios en PR ${identifier}"

  - event: "pr:review_requested"
    status:
      emoji: ":eyes:"
      text: "Revisando ${identifier}: ${title}"

  - event: "linear:issue:in_progress"
    status:
      emoji: ":computer:"
      text: "Trabajando en ${identifier}"

  - event: "pr:authored:open"
    status:
      emoji: ":git-pr:"
      text: "PR abierta: ${identifier}"

  - event: "issue:assigned"
    status:
      emoji: ":github:"
      text: "Issue ${identifier}"

defaultStatus:
  emoji: ""
  text: ""
```

**Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts slacker.config.example.yaml
git commit -m "feat: add configuration schema and loader"
```

---

## Task 4: SQLite State Store

**Files:**
- Create: `src/store/store.ts`
- Create: `src/store/sqlite.ts`
- Create: `src/store/sqlite.test.ts`

**Step 1: Create the StateStore interface**

```typescript
// src/store/store.ts
// ABOUTME: Interface definition for event state storage
// ABOUTME: Abstracts storage implementation for testability

import type { StatusEvent } from '../types.js';

export interface StateStore {
  upsert(event: StatusEvent): void;
  getActive(): StatusEvent[];
  get(id: string): StatusEvent | null;
  deactivate(id: string): void;
  prune(olderThan: Date): number;
  close(): void;
}
```

**Step 2: Write tests for SQLite store**

```typescript
// src/store/sqlite.test.ts
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
```

**Step 3: Run test to verify it fails**

Run: `npm test -- src/store/sqlite.test.ts`
Expected: FAIL - Cannot find module './sqlite.js'

**Step 4: Implement SQLite store**

```typescript
// src/store/sqlite.ts
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
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/store/sqlite.test.ts`
Expected: PASS - All tests green

**Step 6: Commit**

```bash
git add src/store/
git commit -m "feat: add SQLite state store"
```

---

## Task 5: Template Rendering

**Files:**
- Create: `src/engine/template.ts`
- Create: `src/engine/template.test.ts`

**Step 1: Write tests for template rendering**

```typescript
// src/engine/template.test.ts
// ABOUTME: Tests for status template rendering
// ABOUTME: Validates variable interpolation in status text

import { describe, it, expect } from 'vitest';
import { renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('renders a simple template', () => {
    const result = renderTemplate('Hello ${name}', { name: 'Diego' });
    expect(result).toBe('Hello Diego');
  });

  it('renders multiple variables', () => {
    const result = renderTemplate('Reviewing ${identifier}: ${title}', {
      identifier: '#123',
      title: 'Fix bug',
    });
    expect(result).toBe('Reviewing #123: Fix bug');
  });

  it('leaves unknown variables as-is', () => {
    const result = renderTemplate('Hello ${unknown}', {});
    expect(result).toBe('Hello ${unknown}');
  });

  it('handles nested context access', () => {
    const result = renderTemplate('By ${author.name}', {
      author: { name: 'Diego' },
    });
    expect(result).toBe('By Diego');
  });

  it('returns original text when no variables', () => {
    const result = renderTemplate('No variables here', { foo: 'bar' });
    expect(result).toBe('No variables here');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/template.test.ts`
Expected: FAIL - Cannot find module './template.js'

**Step 3: Implement template rendering**

```typescript
// src/engine/template.ts
// ABOUTME: Template engine for rendering status text
// ABOUTME: Interpolates ${variable} patterns with context values

export function renderTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path: string) => {
    const value = getNestedValue(context, path.trim());
    return value !== undefined ? String(value) : match;
  });
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/template.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/engine/
git commit -m "feat: add template rendering engine"
```

---

## Task 6: Rule Engine

**Files:**
- Create: `src/engine/rules.ts`
- Create: `src/engine/rules.test.ts`

**Step 1: Write tests for rule engine**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/rules.test.ts`
Expected: FAIL - Cannot find module './rules.js'

**Step 3: Implement rule engine**

```typescript
// src/engine/rules.ts
// ABOUTME: Priority-based rule evaluation for status selection
// ABOUTME: Matches active events against ordered rules to determine Slack status

import type { StatusEvent, SlackStatus } from '../types.js';
import type { Rule, StatusTemplate } from '../config.js';
import { renderTemplate } from './template.js';

export class RuleEngine {
  constructor(
    private rules: Rule[],
    private defaultStatus: StatusTemplate
  ) {}

  evaluate(events: StatusEvent[]): SlackStatus {
    const activeEvents = events.filter((e) => e.active);

    for (const rule of this.rules) {
      const matchedEvent = activeEvents.find((e) => e.type === rule.event);
      if (matchedEvent) {
        return {
          emoji: renderTemplate(rule.status.emoji, matchedEvent.context),
          text: renderTemplate(rule.status.text, matchedEvent.context),
        };
      }
    }

    return {
      emoji: this.defaultStatus.emoji,
      text: this.defaultStatus.text,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/rules.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/engine/rules.ts src/engine/rules.test.ts
git commit -m "feat: add rule engine for priority-based status selection"
```

---

## Task 7: Slack Client

**Files:**
- Create: `src/slack/client.ts`
- Create: `src/slack/client.test.ts`

**Step 1: Write tests for Slack client**

```typescript
// src/slack/client.test.ts
// ABOUTME: Tests for Slack status update client
// ABOUTME: Uses mock to verify API calls without hitting real Slack

import { describe, it, expect, vi } from 'vitest';
import { SlackClient } from './client.js';
import type { SlackStatus } from '../types.js';

describe('SlackClient', () => {
  it('calls users.profile.set with correct parameters', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);
    const status: SlackStatus = {
      emoji: ':eyes:',
      text: 'Reviewing PR #123',
    };

    await client.setStatus(status);

    expect(mockSet).toHaveBeenCalledWith({
      profile: {
        status_emoji: ':eyes:',
        status_text: 'Reviewing PR #123',
      },
    });
  });

  it('clears status when emoji and text are empty', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);

    await client.setStatus({ emoji: '', text: '' });

    expect(mockSet).toHaveBeenCalledWith({
      profile: {
        status_emoji: '',
        status_text: '',
      },
    });
  });

  it('skips update if status unchanged', async () => {
    const mockSet = vi.fn().mockResolvedValue({ ok: true });
    const mockWebClient = {
      users: {
        profile: {
          set: mockSet,
        },
      },
    };

    const client = new SlackClient(mockWebClient as any);
    const status: SlackStatus = { emoji: ':eyes:', text: 'Reviewing' };

    await client.setStatus(status);
    await client.setStatus(status);

    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/slack/client.test.ts`
Expected: FAIL - Cannot find module './client.js'

**Step 3: Implement Slack client**

```typescript
// src/slack/client.ts
// ABOUTME: Slack API client for updating user status
// ABOUTME: Caches current status to avoid redundant API calls

import type { WebClient } from '@slack/web-api';
import type { SlackStatus } from '../types.js';

export class SlackClient {
  private currentStatus: SlackStatus | null = null;

  constructor(private client: WebClient) {}

  async setStatus(status: SlackStatus): Promise<void> {
    if (this.isSameStatus(status)) {
      return;
    }

    await this.client.users.profile.set({
      profile: {
        status_emoji: status.emoji,
        status_text: status.text,
      },
    });

    this.currentStatus = status;
  }

  private isSameStatus(status: SlackStatus): boolean {
    if (!this.currentStatus) {
      return false;
    }
    return (
      this.currentStatus.emoji === status.emoji &&
      this.currentStatus.text === status.text
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/slack/client.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/slack/
git commit -m "feat: add Slack client with status caching"
```

---

## Task 8: Provider Interface

**Files:**
- Create: `src/providers/provider.ts`

**Step 1: Create the Provider interface**

```typescript
// src/providers/provider.ts
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
```

**Step 2: Commit**

```bash
git add src/providers/provider.ts
git commit -m "feat: add Provider interface"
```

---

## Task 9: GitHub Provider

**Files:**
- Create: `src/providers/github.ts`
- Create: `src/providers/github.test.ts`

**Step 1: Write tests for GitHub provider**

```typescript
// src/providers/github.test.ts
// ABOUTME: Tests for GitHub webhook provider
// ABOUTME: Validates event parsing for PRs and issues

import { describe, it, expect } from 'vitest';
import { parseGitHubEvent } from './github.js';

describe('GitHub Provider', () => {
  describe('Pull Request events', () => {
    it('parses PR opened event for author', () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 123,
          title: 'Add feature',
          html_url: 'https://github.com/org/repo/pull/123',
          user: { login: 'diego' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'diego' },
      };

      const events = parseGitHubEvent('pull_request', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('github:pr:org/repo:123');
      expect(events[0].type).toBe('pr:authored:open');
      expect(events[0].active).toBe(true);
      expect(events[0].context.identifier).toBe('#123');
    });

    it('parses review requested event for reviewer', () => {
      const payload = {
        action: 'review_requested',
        pull_request: {
          number: 456,
          title: 'Fix bug',
          html_url: 'https://github.com/org/repo/pull/456',
          user: { login: 'other' },
        },
        requested_reviewer: { login: 'diego' },
        repository: { full_name: 'org/repo' },
        sender: { login: 'other' },
      };

      const events = parseGitHubEvent('pull_request', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('pr:review_requested');
      expect(events[0].active).toBe(true);
    });

    it('parses changes requested on authored PR', () => {
      const payload = {
        action: 'submitted',
        review: { state: 'changes_requested' },
        pull_request: {
          number: 123,
          title: 'Add feature',
          html_url: 'https://github.com/org/repo/pull/123',
          user: { login: 'diego' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'reviewer' },
      };

      const events = parseGitHubEvent('pull_request_review', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('pr:authored:changes_requested');
      expect(events[0].active).toBe(true);
    });

    it('deactivates on PR closed', () => {
      const payload = {
        action: 'closed',
        pull_request: {
          number: 123,
          title: 'Add feature',
          html_url: 'https://github.com/org/repo/pull/123',
          user: { login: 'diego' },
        },
        repository: { full_name: 'org/repo' },
        sender: { login: 'diego' },
      };

      const events = parseGitHubEvent('pull_request', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].active).toBe(false);
    });
  });

  describe('Issue events', () => {
    it('parses issue assigned event', () => {
      const payload = {
        action: 'assigned',
        issue: {
          number: 789,
          title: 'Bug report',
          html_url: 'https://github.com/org/repo/issues/789',
        },
        assignee: { login: 'diego' },
        repository: { full_name: 'org/repo' },
      };

      const events = parseGitHubEvent('issues', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('github:issue:org/repo:789');
      expect(events[0].type).toBe('issue:assigned');
      expect(events[0].active).toBe(true);
    });

    it('deactivates on issue closed', () => {
      const payload = {
        action: 'closed',
        issue: {
          number: 789,
          title: 'Bug report',
          html_url: 'https://github.com/org/repo/issues/789',
          assignee: { login: 'diego' },
        },
        repository: { full_name: 'org/repo' },
      };

      const events = parseGitHubEvent('issues', payload, 'diego');

      expect(events).toHaveLength(1);
      expect(events[0].active).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/providers/github.test.ts`
Expected: FAIL - Cannot find module './github.js'

**Step 3: Implement GitHub provider**

```typescript
// src/providers/github.ts
// ABOUTME: GitHub webhook provider for PR and issue events
// ABOUTME: Parses GitHub webhooks and produces StatusEvents

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Provider, ProviderConfig } from './provider.js';
import type { StatusEvent } from '../types.js';

export interface GitHubProviderOptions {
  config: ProviderConfig;
  username: string;
  onEvent: (events: StatusEvent[]) => void;
}

export class GitHubProvider implements Provider {
  readonly name = 'github';

  constructor(private options: GitHubProviderOptions) {}

  registerRoutes(server: FastifyInstance): void {
    server.post('/webhooks/github', async (request, reply) => {
      if (!this.verifySignature(request)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const eventType = request.headers['x-github-event'] as string;
      const payload = request.body;

      const events = parseGitHubEvent(eventType, payload, this.options.username);
      if (events.length > 0) {
        this.options.onEvent(events);
      }

      return reply.status(200).send({ ok: true });
    });
  }

  private verifySignature(request: FastifyRequest): boolean {
    const signature = request.headers['x-hub-signature-256'] as string;
    if (!signature) return false;

    const body = JSON.stringify(request.body);
    const expected = 'sha256=' + createHmac('sha256', this.options.config.webhookSecret)
      .update(body)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

export function parseGitHubEvent(
  eventType: string,
  payload: any,
  username: string
): StatusEvent[] {
  const now = new Date();

  if (eventType === 'pull_request') {
    return parsePullRequestEvent(payload, username, now);
  }

  if (eventType === 'pull_request_review') {
    return parsePullRequestReviewEvent(payload, username, now);
  }

  if (eventType === 'issues') {
    return parseIssueEvent(payload, username, now);
  }

  return [];
}

function parsePullRequestEvent(
  payload: any,
  username: string,
  now: Date
): StatusEvent[] {
  const pr = payload.pull_request;
  const repo = payload.repository.full_name;
  const id = `github:pr:${repo}:${pr.number}`;

  const baseEvent: Omit<StatusEvent, 'type' | 'active'> = {
    id,
    provider: 'github',
    context: {
      title: pr.title,
      url: pr.html_url,
      identifier: `#${pr.number}`,
      repository: repo,
    },
    createdAt: now,
    updatedAt: now,
  };

  const isAuthor = pr.user.login === username;
  const isClosed = payload.action === 'closed';
  const isReviewRequested = payload.action === 'review_requested' &&
    payload.requested_reviewer?.login === username;

  if (isClosed) {
    return [{
      ...baseEvent,
      type: isAuthor ? 'pr:authored:open' : 'pr:review_requested',
      active: false,
    }];
  }

  if (isReviewRequested) {
    return [{
      ...baseEvent,
      type: 'pr:review_requested',
      active: true,
    }];
  }

  if (isAuthor && payload.action === 'opened') {
    return [{
      ...baseEvent,
      type: 'pr:authored:open',
      active: true,
    }];
  }

  return [];
}

function parsePullRequestReviewEvent(
  payload: any,
  username: string,
  now: Date
): StatusEvent[] {
  const pr = payload.pull_request;
  const repo = payload.repository.full_name;
  const id = `github:pr:${repo}:${pr.number}`;
  const isAuthor = pr.user.login === username;

  if (!isAuthor) return [];

  const review = payload.review;
  if (payload.action !== 'submitted') return [];

  const baseEvent: Omit<StatusEvent, 'type' | 'active'> = {
    id,
    provider: 'github',
    context: {
      title: pr.title,
      url: pr.html_url,
      identifier: `#${pr.number}`,
      repository: repo,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (review.state === 'changes_requested') {
    return [{
      ...baseEvent,
      type: 'pr:authored:changes_requested',
      active: true,
    }];
  }

  if (review.state === 'approved') {
    return [{
      ...baseEvent,
      type: 'pr:authored:approved',
      active: true,
    }];
  }

  return [];
}

function parseIssueEvent(
  payload: any,
  username: string,
  now: Date
): StatusEvent[] {
  const issue = payload.issue;
  const repo = payload.repository.full_name;
  const id = `github:issue:${repo}:${issue.number}`;

  const baseEvent: Omit<StatusEvent, 'type' | 'active'> = {
    id,
    provider: 'github',
    context: {
      title: issue.title,
      url: issue.html_url,
      identifier: `#${issue.number}`,
      repository: repo,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (payload.action === 'assigned' && payload.assignee?.login === username) {
    return [{
      ...baseEvent,
      type: 'issue:assigned',
      active: true,
    }];
  }

  if (payload.action === 'closed' && issue.assignee?.login === username) {
    return [{
      ...baseEvent,
      type: 'issue:assigned',
      active: false,
    }];
  }

  if (payload.action === 'unassigned' && payload.assignee?.login === username) {
    return [{
      ...baseEvent,
      type: 'issue:assigned',
      active: false,
    }];
  }

  return [];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/providers/github.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/providers/github.ts src/providers/github.test.ts
git commit -m "feat: add GitHub webhook provider"
```

---

## Task 10: Linear Provider

**Files:**
- Create: `src/providers/linear.ts`
- Create: `src/providers/linear.test.ts`

**Step 1: Write tests for Linear provider**

```typescript
// src/providers/linear.test.ts
// ABOUTME: Tests for Linear webhook provider
// ABOUTME: Validates event parsing for issue state changes

import { describe, it, expect } from 'vitest';
import { parseLinearEvent } from './linear.js';

describe('Linear Provider', () => {
  it('parses issue moved to In Progress', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-uuid',
        identifier: 'PROJ-123',
        title: 'Implement feature',
        url: 'https://linear.app/team/issue/PROJ-123',
        state: { name: 'In Progress' },
        assignee: { id: 'user-uuid', email: 'diego@example.com' },
      },
      updatedFrom: {
        stateId: 'old-state',
      },
    };

    const events = parseLinearEvent(payload, 'diego@example.com');

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('linear:issue:issue-uuid');
    expect(events[0].type).toBe('linear:issue:in_progress');
    expect(events[0].active).toBe(true);
    expect(events[0].context.identifier).toBe('PROJ-123');
  });

  it('parses issue moved to In Review', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-uuid',
        identifier: 'PROJ-456',
        title: 'Review this',
        url: 'https://linear.app/team/issue/PROJ-456',
        state: { name: 'In Review' },
        assignee: { id: 'user-uuid', email: 'diego@example.com' },
      },
      updatedFrom: {
        stateId: 'old-state',
      },
    };

    const events = parseLinearEvent(payload, 'diego@example.com');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('linear:issue:in_review');
  });

  it('deactivates issue when moved to Done', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-uuid',
        identifier: 'PROJ-789',
        title: 'Completed task',
        url: 'https://linear.app/team/issue/PROJ-789',
        state: { name: 'Done' },
        assignee: { id: 'user-uuid', email: 'diego@example.com' },
      },
      updatedFrom: {
        stateId: 'old-state',
      },
    };

    const events = parseLinearEvent(payload, 'diego@example.com');

    expect(events).toHaveLength(1);
    expect(events[0].active).toBe(false);
  });

  it('ignores events for other users', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-uuid',
        identifier: 'PROJ-123',
        title: 'Other task',
        url: 'https://linear.app/team/issue/PROJ-123',
        state: { name: 'In Progress' },
        assignee: { id: 'other-uuid', email: 'other@example.com' },
      },
      updatedFrom: {
        stateId: 'old-state',
      },
    };

    const events = parseLinearEvent(payload, 'diego@example.com');

    expect(events).toHaveLength(0);
  });

  it('handles issue creation', () => {
    const payload = {
      action: 'create',
      type: 'Issue',
      data: {
        id: 'new-issue-uuid',
        identifier: 'PROJ-999',
        title: 'New task',
        url: 'https://linear.app/team/issue/PROJ-999',
        state: { name: 'In Progress' },
        assignee: { id: 'user-uuid', email: 'diego@example.com' },
      },
    };

    const events = parseLinearEvent(payload, 'diego@example.com');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('linear:issue:in_progress');
    expect(events[0].active).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/providers/linear.test.ts`
Expected: FAIL - Cannot find module './linear.js'

**Step 3: Implement Linear provider**

```typescript
// src/providers/linear.ts
// ABOUTME: Linear webhook provider for issue events
// ABOUTME: Parses Linear webhooks and produces StatusEvents based on issue state

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Provider, ProviderConfig } from './provider.js';
import type { StatusEvent } from '../types.js';

export interface LinearProviderOptions {
  config: ProviderConfig;
  userEmail: string;
  onEvent: (events: StatusEvent[]) => void;
}

export class LinearProvider implements Provider {
  readonly name = 'linear';

  constructor(private options: LinearProviderOptions) {}

  registerRoutes(server: FastifyInstance): void {
    server.post('/webhooks/linear', async (request, reply) => {
      if (!this.verifySignature(request)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const payload = request.body as any;
      const events = parseLinearEvent(payload, this.options.userEmail);

      if (events.length > 0) {
        this.options.onEvent(events);
      }

      return reply.status(200).send({ ok: true });
    });
  }

  private verifySignature(request: FastifyRequest): boolean {
    const signature = request.headers['linear-signature'] as string;
    if (!signature) return false;

    const body = JSON.stringify(request.body);
    const expected = createHmac('sha256', this.options.config.webhookSecret)
      .update(body)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

const STATE_MAP: Record<string, string> = {
  'in progress': 'linear:issue:in_progress',
  'in review': 'linear:issue:in_review',
  'todo': 'linear:issue:todo',
  'backlog': 'linear:issue:backlog',
};

const INACTIVE_STATES = ['done', 'canceled', 'cancelled', 'archived'];

export function parseLinearEvent(
  payload: any,
  userEmail: string
): StatusEvent[] {
  if (payload.type !== 'Issue') return [];

  const data = payload.data;
  const assignee = data.assignee;

  if (!assignee || assignee.email !== userEmail) return [];

  const now = new Date();
  const stateName = data.state?.name?.toLowerCase() || '';
  const isInactive = INACTIVE_STATES.includes(stateName);

  const eventType = STATE_MAP[stateName] || 'linear:issue:other';

  return [{
    id: `linear:issue:${data.id}`,
    provider: 'linear',
    type: eventType,
    active: !isInactive,
    context: {
      title: data.title,
      url: data.url,
      identifier: data.identifier,
      state: data.state?.name,
    },
    createdAt: now,
    updatedAt: now,
  }];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/providers/linear.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/providers/linear.ts src/providers/linear.test.ts
git commit -m "feat: add Linear webhook provider"
```

---

## Task 11: HTTP Server

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`

**Step 1: Write tests for server**

```typescript
// src/server.test.ts
// ABOUTME: Tests for HTTP server setup and health endpoints
// ABOUTME: Validates server initialization and basic routes

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from './server.js';
import type { Config } from './config.js';

const testConfig: Config = {
  slack: { token: 'test-token' },
  providers: {},
  rules: [],
  defaultStatus: { emoji: '', text: '' },
};

describe('Server', () => {
  it('responds to health check', async () => {
    const server = createServer(testConfig, ':memory:');

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await server.close();
  });

  it('responds to status endpoint', async () => {
    const server = createServer(testConfig, ':memory:');

    const response = await server.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('activeEvents');
    expect(body).toHaveProperty('currentStatus');

    await server.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server.test.ts`
Expected: FAIL - Cannot find module './server.js'

**Step 3: Implement server**

```typescript
// src/server.ts
// ABOUTME: HTTP server setup with provider registration
// ABOUTME: Initializes Fastify, registers routes, and coordinates components

import Fastify, { type FastifyInstance } from 'fastify';
import { WebClient } from '@slack/web-api';
import type { Config } from './config.js';
import { SQLiteStore } from './store/sqlite.js';
import { RuleEngine } from './engine/rules.js';
import { SlackClient } from './slack/client.js';
import { GitHubProvider } from './providers/github.js';
import { LinearProvider } from './providers/linear.js';
import type { StatusEvent } from './types.js';
import type { Provider } from './providers/provider.js';

export function createServer(config: Config, dbPath: string): FastifyInstance {
  const server = Fastify({ logger: true });
  const store = new SQLiteStore(dbPath);
  const ruleEngine = new RuleEngine(config.rules, config.defaultStatus);
  const slackClient = new SlackClient(new WebClient(config.slack.token));

  const handleEvent = async (events: StatusEvent[]) => {
    for (const event of events) {
      store.upsert(event);
    }
    const activeEvents = store.getActive();
    const status = ruleEngine.evaluate(activeEvents);
    await slackClient.setStatus(status);
  };

  const providers: Provider[] = [];

  if (config.providers.github) {
    providers.push(new GitHubProvider({
      config: config.providers.github,
      username: process.env.GITHUB_USERNAME || '',
      onEvent: handleEvent,
    }));
  }

  if (config.providers.linear) {
    providers.push(new LinearProvider({
      config: config.providers.linear,
      userEmail: process.env.LINEAR_USER_EMAIL || '',
      onEvent: handleEvent,
    }));
  }

  for (const provider of providers) {
    provider.registerRoutes(server);
  }

  server.get('/health', async () => ({ ok: true }));

  server.get('/status', async () => {
    const activeEvents = store.getActive();
    const currentStatus = ruleEngine.evaluate(activeEvents);
    return {
      activeEvents,
      currentStatus,
    };
  });

  server.addHook('onClose', () => {
    store.close();
  });

  return server;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server.test.ts`
Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: add HTTP server with provider registration"
```

---

## Task 12: Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Create entry point**

```typescript
// src/index.ts
// ABOUTME: Application entry point
// ABOUTME: Loads config, initializes server, and starts listening

import { loadConfig } from './config.js';
import { createServer } from './server.js';

const CONFIG_PATH = process.env.CONFIG_PATH || 'slacker.config.yaml';
const DB_PATH = process.env.DB_PATH || 'slacker.db';
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('Loading configuration...');
  const config = loadConfig(CONFIG_PATH);

  console.log('Starting server...');
  const server = createServer(config, DB_PATH);

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`Slacker running on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds, dist/ folder created

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add application entry point"
```

---

## Task 13: Integration Test

**Files:**
- Create: `src/integration.test.ts`

**Step 1: Write integration test**

```typescript
// src/integration.test.ts
// ABOUTME: End-to-end integration tests
// ABOUTME: Validates full webhook flow from receipt to status update

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { createServer } from './server.js';
import type { Config } from './config.js';

const GITHUB_SECRET = 'test-github-secret';

const testConfig: Config = {
  slack: { token: 'xoxb-test' },
  providers: {
    github: { webhookSecret: GITHUB_SECRET },
  },
  rules: [
    {
      event: 'pr:review_requested',
      status: { emoji: ':eyes:', text: 'Reviewing ${identifier}' },
    },
  ],
  defaultStatus: { emoji: '', text: '' },
};

function signPayload(payload: object, secret: string): string {
  const body = JSON.stringify(payload);
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('Integration', () => {
  beforeEach(() => {
    process.env.GITHUB_USERNAME = 'diego';
  });

  it('processes GitHub webhook and updates status', async () => {
    const server = createServer(testConfig, ':memory:');

    const payload = {
      action: 'review_requested',
      pull_request: {
        number: 42,
        title: 'Test PR',
        html_url: 'https://github.com/org/repo/pull/42',
        user: { login: 'other' },
      },
      requested_reviewer: { login: 'diego' },
      repository: { full_name: 'org/repo' },
      sender: { login: 'other' },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signPayload(payload, GITHUB_SECRET),
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/status',
    });

    const status = statusResponse.json();
    expect(status.activeEvents).toHaveLength(1);
    expect(status.currentStatus.emoji).toBe(':eyes:');
    expect(status.currentStatus.text).toBe('Reviewing #42');

    await server.close();
  });

  it('rejects webhook with invalid signature', async () => {
    const server = createServer(testConfig, ':memory:');

    const payload = { action: 'opened' };

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=invalid',
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);

    await server.close();
  });
});
```

**Step 2: Run integration tests**

Run: `npm test -- src/integration.test.ts`
Expected: PASS - All tests green

**Step 3: Commit**

```bash
git add src/integration.test.ts
git commit -m "test: add integration tests"
```

---

## Task 14: Final Verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: complete initial implementation"
```

---

## Summary

Implementation complete. The project includes:

- **Types**: Core `StatusEvent` with Zod validation
- **Config**: YAML config with env var interpolation
- **Store**: SQLite persistence
- **Engine**: Template rendering + priority-based rule evaluation
- **Slack**: Status client with caching
- **Providers**: GitHub + Linear webhook handlers
- **Server**: Fastify HTTP server
- **Tests**: Unit + integration tests

Next steps for production:
1. Create `slacker.config.yaml` from example
2. Set up Slack app and get token
3. Configure webhooks in GitHub/Linear
4. Run with tunnel (cloudflared/ngrok)
