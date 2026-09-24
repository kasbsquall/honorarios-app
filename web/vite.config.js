import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // The port is set by the main walkthrough, e2e/demo.mjs, which targets 5196 by default.
  // With the stock 5173, `npm run dev` started a server the scripts could not reach.
  server: { port: 5196 },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), pay: resolve(__dirname, "pay.html") },
    },
  },
});
