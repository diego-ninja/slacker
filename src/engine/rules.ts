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
    const activeEvents = events.filter((e) => e.active).sort((left, right) => {
      const recency = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (recency !== 0) return recency;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

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
