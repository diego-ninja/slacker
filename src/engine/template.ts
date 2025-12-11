// src/engine/template.ts
// ABOUTME: Template engine for rendering status text
// ABOUTME: Interpolates ${variable} patterns with context values

export function renderTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path: string) => {
    const value = getNestedValue(context, path.trim());
    return value !== undefined ? String(value) : match;
  });
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
