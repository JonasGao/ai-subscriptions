import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    // Dev server proxy: `npm run dev` talks to the Go server on :3000.
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
  },
});
