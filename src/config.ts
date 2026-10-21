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

const NonEmptyString = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');

export const ConfigSchema = z.object({
  slack: z.object({
    token: NonEmptyString,
  }),
  providers: z.object({
    github: z.object({ webhookSecret: NonEmptyString, username: NonEmptyString }).optional(),
    linear: z.object({ webhookSecret: NonEmptyString, userEmail: z.string().email() }).optional(),
  }).strict().default({}),
  rules: z.array(RuleSchema).default([]),
  defaultStatus: StatusTemplateSchema,
  statusToken: NonEmptyString.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type StatusTemplate = z.infer<typeof StatusTemplateSchema>;

function resolveValue(value: unknown, environmentName?: string): unknown {
  if (value === undefined && environmentName) return process.env[environmentName];
  if (typeof value !== 'string') return value;

  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const replacement = process.env[name];
    if (replacement === undefined) throw new Error(`Missing environment variable: ${name}`);
    return replacement;
  });
}

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const input = z.object({
    slack: z.record(z.unknown()),
    providers: z.record(z.unknown()).default({}),
  }).passthrough().parse(parseYaml(raw));

  const providers = { ...input.providers };
  for (const [name, identity, environmentName] of [
    ['github', 'username', 'GITHUB_USERNAME'],
    ['linear', 'userEmail', 'LINEAR_USER_EMAIL'],
  ]) {
    if (providers[name] === undefined) continue;
    const provider = z.record(z.unknown()).parse(providers[name]);
    providers[name] = {
      ...provider,
      webhookSecret: resolveValue(provider.webhookSecret),
      [identity]: resolveValue(provider[identity], environmentName),
    };
  }

  return ConfigSchema.parse({
    ...input,
    slack: { ...input.slack, token: resolveValue(input.slack.token) },
    providers,
    statusToken: resolveValue(input.statusToken, 'STATUS_TOKEN'),
  });
}
