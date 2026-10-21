// ABOUTME: Selects source tests for local and CI verification
// ABOUTME: Excludes compiled output from test discovery

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
