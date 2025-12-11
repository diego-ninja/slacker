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
