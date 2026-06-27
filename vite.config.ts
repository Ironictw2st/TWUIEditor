import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Tauri expects a fixed port and ignores HMR websocket on the same.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Expose the app version (from package.json) to the frontend as a compile-time constant.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own chunks so the app bundle stays small
        // and no single chunk trips Vite's 500 kB warning. (dockview is the largest dep.)
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("dockview")) return "vendor-dockview";
          if (id.includes("@dnd-kit")) return "vendor-dndkit";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
        },
      },
    },
  },
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
