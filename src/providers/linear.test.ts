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
