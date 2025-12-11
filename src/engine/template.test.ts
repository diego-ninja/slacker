// src/engine/template.test.ts
// ABOUTME: Tests for status template rendering
// ABOUTME: Validates variable interpolation in status text

import { describe, it, expect } from 'vitest';
import { renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('renders a simple template', () => {
    const result = renderTemplate('Hello ${name}', { name: 'Diego' });
    expect(result).toBe('Hello Diego');
  });

  it('renders multiple variables', () => {
    const result = renderTemplate('Reviewing ${identifier}: ${title}', {
      identifier: '#123',
      title: 'Fix bug',
    });
    expect(result).toBe('Reviewing #123: Fix bug');
  });

  it('leaves unknown variables as-is', () => {
    const result = renderTemplate('Hello ${unknown}', {});
    expect(result).toBe('Hello ${unknown}');
  });

  it('handles nested context access', () => {
    const result = renderTemplate('By ${author.name}', {
      author: { name: 'Diego' },
    });
    expect(result).toBe('By Diego');
  });

  it('returns original text when no variables', () => {
    const result = renderTemplate('No variables here', { foo: 'bar' });
    expect(result).toBe('No variables here');
  });
});
