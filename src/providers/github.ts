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
