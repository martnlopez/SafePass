import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Argon2id es costoso a propósito
    testTimeout: 20_000,
  },
})
