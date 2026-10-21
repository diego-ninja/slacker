// ABOUTME: Tests GitHub event transitions and source versions
// ABOUTME: Covers authored work, review completion, assignment, and reopening

import { describe, it, expect } from 'vitest';
import { parseGitHubEvent } from './github.js';

const CREATED = '2026-10-20T10:00:00Z';
const UPDATED = '2026-10-21T10:00:00Z';
const REVIEWED = '2026-10-21T10:01:00Z';

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 123, title: 'Add feature', html_url: 'https://github.com/org/repo/pull/123',
    user: { login: 'diego' }, state: 'open', requested_reviewers: [],
    created_at: CREATED, updated_at: UPDATED, ...overrides,
  };
}

function prEvent(action: string, overrides: Record<string, unknown> = {}) {
  return { action, pull_request: pullRequest(), repository: { full_name: 'org/repo' }, ...overrides };
}

function issueEvent(action: string, issue: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    action,
    issue: {
      number: 789, title: 'Bug report', html_url: 'https://github.com/org/repo/issues/789',
      state: 'open', assignees: [{ login: 'diego' }], created_at: CREATED, updated_at: UPDATED, ...issue,
    },
    repository: { full_name: 'org/repo' }, ...extra,
  };
}

describe('GitHub Provider', () => {
  it('parses an authored PR with source dates', () => {
    expect(parseGitHubEvent('pull_request', prEvent('opened'), 'diego')).toMatchObject([{
      id: 'github:pr:org/repo:123', type: 'pr:authored:open', active: true,
      createdAt: new Date(CREATED), updatedAt: new Date(UPDATED), context: { identifier: '#123' },
    }]);
  });

  it('parses a requested review', () => {
    expect(parseGitHubEvent('pull_request', prEvent('review_requested', {
      pull_request: pullRequest({ user: { login: 'other' } }), requested_reviewer: { login: 'diego' },
    }), 'diego')).toMatchObject([{ type: 'pr:review_requested', active: true }]);
  });

  it.each(['approved', 'changes_requested'])('parses %s on an authored PR', (state) => {
    expect(parseGitHubEvent('pull_request_review', prEvent('submitted', {
      review: { state, submitted_at: REVIEWED, user: { login: 'reviewer' } },
    }), 'diego')).toMatchObject([{
      type: `pr:authored:${state}`, active: true, updatedAt: new Date(REVIEWED),
    }]);
  });

  it('deactivates a closed authored PR', () => {
    expect(parseGitHubEvent('pull_request', prEvent('closed', {
      pull_request: pullRequest({ state: 'closed' }),
    }), 'diego')).toMatchObject([{ active: false }]);
  });

  it('reactivates a reopened authored PR', () => {
    expect(parseGitHubEvent('pull_request', prEvent('reopened'), 'diego'))
      .toMatchObject([{ type: 'pr:authored:open', active: true }]);
  });

  it.each(['approved', 'changes_requested', 'commented'])('clears a requested review after submitting %s', (state) => {
    expect(parseGitHubEvent('pull_request_review', prEvent('submitted', {
      pull_request: pullRequest({ user: { login: 'other' } }),
      review: { state, submitted_at: REVIEWED, user: { login: 'diego' } },
    }), 'diego')).toMatchObject([{
      type: 'pr:review_requested', active: false, updatedAt: new Date(REVIEWED),
    }]);
  });

  it('clears a removed review request', () => {
    expect(parseGitHubEvent('pull_request', prEvent('review_request_removed', {
      pull_request: pullRequest({ user: { login: 'other' } }), requested_reviewer: { login: 'diego' },
    }), 'diego')).toMatchObject([{ type: 'pr:review_requested', active: false }]);
  });

  it('deactivates a closed PR with a pending review', () => {
    expect(parseGitHubEvent('pull_request', prEvent('closed', {
      pull_request: pullRequest({ state: 'closed', user: { login: 'other' }, requested_reviewers: [{ login: 'diego' }] }),
    }), 'diego')).toMatchObject([{ type: 'pr:review_requested', active: false }]);
  });

  it('emits a close tombstone even when pending reviewers were removed', () => {
    const [pending] = parseGitHubEvent('pull_request', prEvent('review_requested', {
      pull_request: pullRequest({ user: { login: 'other' } }), requested_reviewer: { login: 'diego' },
    }), 'diego');
    expect(parseGitHubEvent('pull_request', prEvent('closed', {
      pull_request: pullRequest({ state: 'closed', user: { login: 'other' }, requested_reviewers: [] }),
    }), 'diego')).toMatchObject([{ id: pending.id, type: 'pr:review_requested', active: false }]);
  });

  it('ignores unrelated PRs and reviews', () => {
    const foreign = pullRequest({ state: 'closed', user: { login: 'other' } });
    expect(parseGitHubEvent('pull_request', prEvent('opened', { pull_request: foreign }), 'diego')).toEqual([]);
    expect(parseGitHubEvent('pull_request_review', prEvent('submitted', {
      pull_request: foreign, review: { state: 'approved', submitted_at: REVIEWED, user: { login: 'someone' } },
    }), 'diego')).toEqual([]);
  });

  it('does not reactivate a closed PR after a late review', () => {
    expect(parseGitHubEvent('pull_request_review', prEvent('submitted', {
      pull_request: pullRequest({ state: 'closed', updated_at: '2026-10-21T10:02:00Z' }),
      review: { state: 'approved', submitted_at: REVIEWED, user: { login: 'reviewer' } },
    }), 'diego')).toMatchObject([{ active: false, updatedAt: new Date('2026-10-21T10:02:00Z') }]);
  });

  it.each(['opened', 'reopened', 'assigned'])('tracks %s issues assigned to the user', (action) => {
    expect(parseGitHubEvent('issues', issueEvent(action, {}, { assignee: { login: 'diego' } }), 'diego'))
      .toMatchObject([{ id: 'github:issue:org/repo:789', type: 'issue:assigned', active: true, updatedAt: new Date(UPDATED) }]);
  });

  it('deactivates a closed issue when the user is not the primary assignee', () => {
    expect(parseGitHubEvent('issues', issueEvent('closed', {
      state: 'closed', assignee: { login: 'other' }, assignees: [{ login: 'other' }, { login: 'diego' }],
    }), 'diego')).toMatchObject([{ active: false }]);
  });

  it('emits a close tombstone even when the assignees are empty', () => {
    const [assigned] = parseGitHubEvent('issues', issueEvent('assigned', {}, { assignee: { login: 'diego' } }), 'diego');
    expect(parseGitHubEvent('issues', issueEvent('closed', { state: 'closed', assignee: null, assignees: [] }), 'diego'))
      .toMatchObject([{ id: assigned.id, type: 'issue:assigned', active: false }]);
  });

  it('deactivates unassigned issues and ignores unrelated assignments', () => {
    expect(parseGitHubEvent('issues', issueEvent('unassigned', { assignees: [] }, { assignee: { login: 'diego' } }), 'diego'))
      .toMatchObject([{ active: false }]);
    expect(parseGitHubEvent('issues', issueEvent('assigned', { assignees: [{ login: 'other' }] }, { assignee: { login: 'other' } }), 'diego'))
      .toEqual([]);
  });

  it.each([undefined, 'not-a-date'])('rejects a missing or invalid source timestamp (%s)', (updated_at) => {
    expect(() => parseGitHubEvent('pull_request', prEvent('opened', { pull_request: pullRequest({ updated_at }) }), 'diego')).toThrow();
  });
});
