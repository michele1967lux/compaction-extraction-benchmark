import { defineConfig } from 'vitest/config'

/**
 * Explicit, self-contained Vitest config so the test runner does not climb
 * up to the parent `deepseek-harness/vitest.config.ts` (which references
 * workspace-only plugins this standalone module does not depend on).
 */
export default defineConfig({
  test: {
    root: __dirname,
    include: ['tests/**/*.spec.ts'],
  },
})
