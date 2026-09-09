import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// ============================================================
// TBL Live v3.1.0 — Configuration Vitest
//
// Les tests vivent dans tests/*.test.ts et importent les modules
// de src/ via des chemins relatifs OU l'alias « @/ » (résolu ici
// comme dans Next.js — nécessaire depuis que certains modules
// testés, p. ex. la file d'écriture, importent '@/lib/db').
// ============================================================

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
