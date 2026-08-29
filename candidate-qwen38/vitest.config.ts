/**
 * Local Vitest config so the standalone module never resolves the parent
 * repository's config (different workspace, different dependencies).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
