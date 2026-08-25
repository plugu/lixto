import { defineConfig } from "vitest/config";

// Without an explicit exclude, `vitest run` after `next build` also
// discovers the `.next/standalone` copies of these same *.test.ts files
// (Next.js bundles the whole tree into standalone output), doubling every
// test. Keep node_modules excluded too (default, but explicit here since we
// override `test.exclude`).
export default defineConfig({
  test: {
    exclude: ["**/.next/**", "**/node_modules/**"],
  },
});
