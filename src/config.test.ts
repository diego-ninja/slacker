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
