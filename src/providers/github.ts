// ABOUTME: Receives GitHub webhooks and derives relevant PR and issue state
// ABOUTME: Preserves source versions and clears completed or removed work

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SourceTimestampSchema, type EventHandler, type Provider, type ProviderConfig } from './provider.js';
import { registerWebhook } from './webhook.js';
import type { StatusEvent } from '../types.js';

export interface GitHubProviderOptions {
  config: ProviderConfig;
  username: string;
  onEvent: EventHandler;
}

export class GitHubProvider implements Provider {
  readonly name = 'github';

  constructor(private options: GitHubProviderOptions) {}

  registerRoutes(server: FastifyInstance): void {
    registerWebhook(server, {
      path: '/webhooks/github', secret: this.options.config.webhookSecret,
      signatureHeader: 'x-hub-signature-256', signaturePrefix: 'sha256=',
      parse: (payload, request) => parseGitHubEvent(
        z.string().min(1).parse(request.headers['x-github-event']), payload, this.options.username,
      ),
      onEvent: this.options.onEvent,
    });
  }
}

const UserSchema = z.object({ login: z.string().min(1) });
const EntitySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  html_url: z.string().url(),
  state: z.enum(['open', 'closed']),
  created_at: SourceTimestampSchema.optional(),
  updated_at: SourceTimestampSchema,
});
const PullRequestSchema = EntitySchema.extend({
  user: UserSchema,
  requested_reviewers: z.array(UserSchema).default([]),
});
const PullRequestEventSchema = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string().min(1) }),
  pull_request: PullRequestSchema,
  requested_reviewer: UserSchema.optional(),
});
const ReviewEventSchema = PullRequestEventSchema.extend({
  review: z.object({
    state: z.string(), user: UserSchema, submitted_at: SourceTimestampSchema.nullable(),
  }),
});
const IssueEventSchema = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string().min(1) }),
  issue: EntitySchema.extend({
    assignee: UserSchema.nullable().optional(), assignees: z.array(UserSchema).optional(),
  }),
  assignee: UserSchema.optional(),
});

export function parseGitHubEvent(eventType: string, payload: unknown, username: string): StatusEvent[] {
  if (eventType === 'pull_request') return parsePullRequestEvent(payload, username);
  if (eventType === 'pull_request_review') return parseReviewEvent(payload, username);
  if (eventType === 'issues') return parseIssueEvent(payload, username);
  return [];
}

function eventFor(
  entity: z.infer<typeof EntitySchema>, repository: string, kind: 'pr' | 'issue',
  type: string, active: boolean, updatedAt = new Date(entity.updated_at),
): StatusEvent {
  return {
    id: `github:${kind}:${repository}:${entity.number}`, provider: 'github', type, active,
    context: {
      title: entity.title, url: entity.html_url, identifier: `#${entity.number}`, repository,
    },
    createdAt: new Date(entity.created_at ?? entity.updated_at), updatedAt,
  };
}

function parsePullRequestEvent(payload: unknown, username: string): StatusEvent[] {
  const { action, pull_request: pr, repository, requested_reviewer } = PullRequestEventSchema.parse(payload);
  const isAuthor = pr.user.login === username;
  const isReviewer = pr.requested_reviewers.some((user) => user.login === username);
  const requestedUser = requested_reviewer?.login === username;
  const type = isAuthor ? 'pr:authored:open' : 'pr:review_requested';

  if (action === 'closed') {
    return [eventFor(pr, repository.full_name, 'pr', type, false)];
  }
  if (action === 'review_request_removed' && requestedUser && !isAuthor) {
    return [eventFor(pr, repository.full_name, 'pr', type, false)];
  }
  if (action === 'review_requested' && requestedUser && !isAuthor) {
    return [eventFor(pr, repository.full_name, 'pr', type, pr.state === 'open')];
  }
  if ((action === 'opened' || action === 'reopened') && (isAuthor || isReviewer)) {
    return [eventFor(pr, repository.full_name, 'pr', type, pr.state === 'open')];
  }
  return [];
}

function parseReviewEvent(payload: unknown, username: string): StatusEvent[] {
  const { action, pull_request: pr, repository, review } = ReviewEventSchema.parse(payload);
  if (action !== 'submitted') return [];
  const submittedAt = SourceTimestampSchema.parse(review.submitted_at);
  const updatedAt = new Date(pr.state === 'closed'
    ? Math.max(Date.parse(pr.updated_at), Date.parse(submittedAt)) : Date.parse(submittedAt));

  if (pr.user.login !== username) {
    return review.user.login === username
      ? [eventFor(pr, repository.full_name, 'pr', 'pr:review_requested', false, updatedAt)] : [];
  }
  if (review.state !== 'approved' && review.state !== 'changes_requested') return [];
  return [eventFor(pr, repository.full_name, 'pr', `pr:authored:${review.state}`, pr.state === 'open', updatedAt)];
}

function parseIssueEvent(payload: unknown, username: string): StatusEvent[] {
  const { action, issue, repository, assignee } = IssueEventSchema.parse(payload);
  const isAssigned = issue.assignees
    ? issue.assignees.some((user) => user.login === username) : issue.assignee?.login === username;
  const assignedUser = assignee?.login === username;
  if (action === 'unassigned' && assignedUser) {
    return [eventFor(issue, repository.full_name, 'issue', 'issue:assigned', false)];
  }
  if (action === 'closed') {
    return [eventFor(issue, repository.full_name, 'issue', 'issue:assigned', false)];
  }
  if ((action === 'assigned' && assignedUser) || ((action === 'opened' || action === 'reopened') && isAssigned)) {
    return [eventFor(issue, repository.full_name, 'issue', 'issue:assigned', issue.state === 'open')];
  }
  return [];
}
