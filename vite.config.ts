import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client" },
  test: {
    include: ["tests/**/*.test.{ts,mjs}"],
    environment: "node",
    clearMocks: true,
  },
});
