// ABOUTME: Tests Linear issue transitions and semantic workflow states
// ABOUTME: Covers ownership changes, deletion, archive, and source timestamps

import { describe, it, expect } from 'vitest';
import { parseLinearEvent } from './linear.js';

const CREATED = '2026-10-20T10:00:00Z';
const UPDATED = '2026-10-21T10:00:00Z';

function payload(data: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) {
  return {
    action: 'update', type: 'Issue', createdAt: UPDATED, webhookTimestamp: Date.now(),
    data: {
      id: 'issue-uuid', identifier: 'PROJ-123', title: 'Implement feature',
      url: 'https://linear.app/team/issue/PROJ-123', state: { name: 'In Progress', type: 'started' },
      assignee: { id: 'user-uuid', email: 'diego@example.com' },
      createdAt: CREATED, updatedAt: UPDATED, archivedAt: null, ...data,
    }, ...envelope,
  };
}

describe('Linear Provider', () => {
  it('parses issue progress using source dates', () => {
    expect(parseLinearEvent(payload(), 'diego@example.com')).toMatchObject([{
      id: 'linear:issue:issue-uuid', type: 'linear:issue:in_progress', active: true,
      context: { identifier: 'PROJ-123' }, createdAt: new Date(CREATED), updatedAt: new Date(UPDATED),
    }]);
  });

  it('preserves the in-review distinction for started states', () => {
    expect(parseLinearEvent(payload({ state: { name: 'In Review', type: 'started' } }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:in_review', active: true }]);
  });

  it.each(['completed', 'canceled'])('deactivates custom-named %s states', (type) => {
    expect(parseLinearEvent(payload({ state: { name: 'Finalizado', type } }), 'diego@example.com'))
      .toMatchObject([{ type: `linear:issue:${type === 'completed' ? 'done' : 'canceled'}`, active: false }]);
  });

  it('prefers semantic states over conflicting display names', () => {
    expect(parseLinearEvent(payload({ state: { name: 'Done', type: 'started' } }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:in_progress', active: true }]);
    expect(parseLinearEvent(payload({ state: { name: 'In Review', type: 'completed' } }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:done', active: false }]);
  });

  it('supports named states when semantic type is unavailable', () => {
    expect(parseLinearEvent(payload({ state: { name: 'Done' } }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:done', active: false }]);
  });

  it('ignores unrelated users without an ownership transition', () => {
    expect(parseLinearEvent(payload({ assignee: { id: 'other', email: 'other@example.com' } }), 'diego@example.com')).toEqual([]);
  });

  it.each([null, { id: 'other', email: 'other@example.com' }])('deactivates ownership transfer (%s)', (assignee) => {
    expect(parseLinearEvent(payload({ assignee }, { updatedFrom: { assigneeId: 'user-uuid' } }), 'diego@example.com'))
      .toMatchObject([{ id: 'linear:issue:issue-uuid', active: false }]);
  });

  it('deactivates archived issues without requiring a state called Archived', () => {
    expect(parseLinearEvent(payload({ archivedAt: UPDATED }), 'diego@example.com')).toMatchObject([{ active: false }]);
  });

  it('deactivates issues moved to the semantic duplicate state', () => {
    expect(parseLinearEvent(payload({ state: { name: 'Repeated task', type: 'duplicate' } }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:other', active: false }]);
  });

  it('creates deletion tombstones using the removal timestamp', () => {
    const removedAt = '2026-10-21T11:00:00Z';
    expect(parseLinearEvent(payload({}, { action: 'remove', createdAt: removedAt }), 'diego@example.com'))
      .toMatchObject([{ active: false, updatedAt: new Date(removedAt) }]);
  });

  it('retains deletion tombstones when an assignee is missing', () => {
    expect(parseLinearEvent(payload({ assignee: undefined }, { action: 'remove' }), 'diego@example.com'))
      .toMatchObject([{ active: false }]);
  });

  it('handles issue creation', () => {
    expect(parseLinearEvent(payload({}, { action: 'create' }), 'diego@example.com'))
      .toMatchObject([{ type: 'linear:issue:in_progress', active: true }]);
  });

  it('falls back to the issue update timestamp for updates', () => {
    expect(parseLinearEvent(payload({}, { createdAt: undefined }), 'diego@example.com'))
      .toMatchObject([{ updatedAt: new Date(UPDATED) }]);
  });

  it('rejects deletion without a removal source timestamp', () => {
    expect(() => parseLinearEvent(payload({}, { action: 'remove', createdAt: undefined }), 'diego@example.com')).toThrow();
  });

  it.each([undefined, 'invalid'])('rejects missing or invalid source versions (%s)', (timestamp) => {
    expect(() => parseLinearEvent(payload({ updatedAt: timestamp }, { createdAt: timestamp }), 'diego@example.com')).toThrow();
  });
});
