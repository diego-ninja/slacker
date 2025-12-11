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

const ProviderConfigSchema = z.object({
  webhookSecret: z.string(),
});

export const ConfigSchema = z.object({
  slack: z.object({
    token: z.string(),
  }),
  providers: z.record(ProviderConfigSchema).default({}),
  rules: z.array(RuleSchema).default([]),
  defaultStatus: StatusTemplateSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type StatusTemplate = z.infer<typeof StatusTemplateSchema>;

function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{(\w+)\}/g, (_, name) => {
    return process.env[name] ?? '';
  });
}

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const interpolated = interpolateEnvVars(raw);
  const parsed = parseYaml(interpolated);
  return ConfigSchema.parse(parsed);
}
