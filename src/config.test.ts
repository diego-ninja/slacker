// ABOUTME: Tests for configuration loading and validation
// ABOUTME: Ensures config schema catches invalid configurations

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ConfigSchema, loadConfig, type Config } from './config.js';

function completeConfig(): Config {
  return {
    slack: { token: 'xoxb-test-token' },
    providers: {
      github: { webhookSecret: 'github-secret', username: 'diego' },
      linear: { webhookSecret: 'linear-secret', userEmail: 'diego@example.com' },
    },
    rules: [{
      event: 'pr:review_requested',
      status: { emoji: ':eyes:', text: 'Reviewing ${identifier}' },
    }],
    defaultStatus: { emoji: '', text: '' },
  };
}

describe('Config', () => {
  it('validates a complete config', () => {
    expect(ConfigSchema.parse(completeConfig())).toEqual(completeConfig());
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

  it.each(['', '   '])('rejects a blank Slack token (%j)', (token) => {
    expect(ConfigSchema.safeParse({ ...completeConfig(), slack: { token } }).success).toBe(false);
  });

  it.each(['', '   '])('rejects a blank status token (%j)', (statusToken) => {
    expect(ConfigSchema.safeParse({ ...completeConfig(), statusToken }).success).toBe(false);
  });

  it.each(['', '   '])('rejects blank GitHub credentials and identities (%j)', (value) => {
    const github = { webhookSecret: 'secret', username: 'diego' };

    for (const field of ['webhookSecret', 'username']) {
      expect(ConfigSchema.safeParse({
        ...completeConfig(),
        providers: { github: { ...github, [field]: value } },
      }).success).toBe(false);
    }
  });

  it.each(['', '   '])('rejects blank Linear credentials and identities (%j)', (value) => {
    const linear = { webhookSecret: 'secret', userEmail: 'diego@example.com' };

    for (const field of ['webhookSecret', 'userEmail']) {
      expect(ConfigSchema.safeParse({
        ...completeConfig(),
        providers: { linear: { ...linear, [field]: value } },
      }).success).toBe(false);
    }
  });

  it('rejects an invalid Linear email', () => {
    expect(ConfigSchema.safeParse({
      ...completeConfig(),
      providers: { linear: { webhookSecret: 'secret', userEmail: 'not-an-email' } },
    }).success).toBe(false);
  });

  it('rejects unknown providers', () => {
    expect(ConfigSchema.safeParse({
      ...completeConfig(),
      providers: { gitlab: { webhookSecret: 'secret' } },
    }).success).toBe(false);
  });
});

describe('loadConfig', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'slacker-config-'));
    for (const name of [
      'SLACK_TOKEN',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_USERNAME',
      'LINEAR_WEBHOOK_SECRET',
      'LINEAR_USER_EMAIL',
      'STATUS_TOKEN',
      'MISSING_CREDENTIAL',
      'identifier',
      'title',
      'url',
      'author.name',
      'emoji',
    ]) {
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  function loadYaml(content: string): Config {
    const path = join(directory, 'slacker.config.yaml');
    writeFileSync(path, content);
    return loadConfig(path);
  }

  it('preserves event placeholders in rules and default status', () => {
    vi.stubEnv('SLACK_TOKEN', 'xoxb-test-token');
    vi.stubEnv('identifier', 'environment-identifier');
    vi.stubEnv('title', 'environment-title');
    vi.stubEnv('url', 'environment-url');
    vi.stubEnv('author.name', 'environment-author');
    vi.stubEnv('emoji', ':environment:');

    const config = loadYaml([
      'slack:',
      '  token: ${SLACK_TOKEN}',
      'rules:',
      '  - event: pr:review_requested',
      '    status:',
      '      emoji: "${emoji}"',
      '      text: "Revisando ${identifier}: ${title} ${url} ${author.name}"',
      'defaultStatus:',
      '  emoji: "${emoji}"',
      '  text: "${identifier} ${title} ${url} ${author.name}"',
    ].join('\n'));

    expect(config.rules[0]).toEqual({
      event: 'pr:review_requested',
      status: {
        emoji: '${emoji}',
        text: 'Revisando ${identifier}: ${title} ${url} ${author.name}',
      },
    });
    expect(config.defaultStatus).toEqual({
      emoji: '${emoji}',
      text: '${identifier} ${title} ${url} ${author.name}',
    });
  });

  it('loads provider credentials and identities from the environment', () => {
    vi.stubEnv('SLACK_TOKEN', 'xoxb-test-token');
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'github-secret');
    vi.stubEnv('GITHUB_USERNAME', 'diego');
    vi.stubEnv('LINEAR_WEBHOOK_SECRET', 'linear-secret');
    vi.stubEnv('LINEAR_USER_EMAIL', 'diego@example.com');
    vi.stubEnv('STATUS_TOKEN', 'debug-secret');

    const config = loadYaml([
      'slack:',
      '  token: ${SLACK_TOKEN}',
      'providers:',
      '  github:',
      '    webhookSecret: ${GITHUB_WEBHOOK_SECRET}',
      '  linear:',
      '    webhookSecret: ${LINEAR_WEBHOOK_SECRET}',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'));

    expect(config.slack.token).toBe('xoxb-test-token');
    expect(config.providers).toEqual(completeConfig().providers);
    expect(config.statusToken).toBe('debug-secret');
  });

  it('prefers explicit YAML identities and status token over environment fallbacks', () => {
    vi.stubEnv('GITHUB_USERNAME', 'environment-user');
    vi.stubEnv('LINEAR_USER_EMAIL', 'environment@example.com');
    vi.stubEnv('STATUS_TOKEN', 'environment-token');

    const config = loadYaml([
      'slack: { token: test-token }',
      'providers:',
      '  github: { webhookSecret: github-secret, username: diego }',
      '  linear: { webhookSecret: linear-secret, userEmail: diego@example.com }',
      'statusToken: explicit-token',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'));

    expect(config.providers).toEqual(completeConfig().providers);
    expect(config.statusToken).toBe('explicit-token');
  });

  it('preserves the literal environment status token with either configuration form', () => {
    const statusToken = 'literal${MISSING_CREDENTIAL}token';
    vi.stubEnv('STATUS_TOKEN', statusToken);
    const yaml = [
      'slack: { token: test-token }',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n');

    const explicit = loadYaml(`${yaml}\nstatusToken: \${STATUS_TOKEN}`);
    const fallback = loadYaml(yaml);

    expect(explicit.statusToken).toBe(statusToken);
    expect(fallback.statusToken).toBe(statusToken);
  });

  it('interpolates explicitly configured identity and status token fields', () => {
    vi.stubEnv('GITHUB_USERNAME', 'diego');
    vi.stubEnv('LINEAR_USER_EMAIL', 'diego@example.com');
    vi.stubEnv('STATUS_TOKEN', 'debug-secret');

    const config = loadYaml([
      'slack: { token: test-token }',
      'providers:',
      '  github: { webhookSecret: github-secret, username: "${GITHUB_USERNAME}" }',
      '  linear: { webhookSecret: linear-secret, userEmail: "${LINEAR_USER_EMAIL}" }',
      'statusToken: ${STATUS_TOKEN}',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'));

    expect(config.providers).toEqual(completeConfig().providers);
    expect(config.statusToken).toBe('debug-secret');
  });

  it.each([
    ['github', 'webhookSecret: secret'],
    ['linear', 'webhookSecret: secret'],
  ])('rejects %s when its identity is absent from YAML and environment', (provider, fields) => {
    expect(() => loadYaml([
      'slack: { token: test-token }',
      'providers:',
      `  ${provider}: { ${fields} }`,
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'))).toThrow();
  });

  it('rejects a missing credential environment variable without including secrets', () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'private-github-secret');
    let error: unknown;

    try {
      loadYaml([
        'slack: { token: "${MISSING_CREDENTIAL}" }',
        'providers:',
        '  github: { webhookSecret: "${GITHUB_WEBHOOK_SECRET}", username: diego }',
        'defaultStatus: { emoji: "", text: "" }',
      ].join('\n'));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private-github-secret');
  });

  it('treats environment values as literal strings after parsing YAML', () => {
    const token = 'xoxb-contraseña: "東京"\nstatusToken: injected # secret';
    const secret = 'secreto: "áéí"\nusername: another-user # secret';
    vi.stubEnv('SLACK_TOKEN', token);
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', secret);
    vi.stubEnv('GITHUB_USERNAME', 'diego');

    const config = loadYaml([
      'slack:',
      '  token: ${SLACK_TOKEN}',
      'providers:',
      '  github:',
      '    webhookSecret: ${GITHUB_WEBHOOK_SECRET}',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'));

    expect(config.slack.token).toBe(token);
    expect(config.providers.github).toEqual({ webhookSecret: secret, username: 'diego' });
    expect(config.statusToken).toBeUndefined();
  });

  it('leaves status access disabled when no token is configured', () => {
    const config = loadYaml([
      'slack: { token: test-token }',
      'defaultStatus: { emoji: "", text: "" }',
    ].join('\n'));

    expect(config.statusToken).toBeUndefined();
    expect(config.providers).toEqual({});
  });
});
