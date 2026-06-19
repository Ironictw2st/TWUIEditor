import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and ignores HMR websocket on the same.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    // Auto-pick the next free port if 1420 is taken (e.g. a stale dev server),
    // instead of crashing the dev command.
    strictPort: false,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the giant 3K game-data folder.
      ignored: ["**/src-tauri/**", "**/3K/**"],
    },
  },
});
