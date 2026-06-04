import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite serves on :5173 and proxies /api -> FastAPI on :8000 in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
