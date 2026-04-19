import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// During dev, Vite runs on :5173 and Gateway on :8080.
// Proxy /api/* to the Gateway so that relative fetches just work.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
      },
      "/health": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
      },
    },
  },
});
