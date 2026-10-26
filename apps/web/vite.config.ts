import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run dev` here + `wrangler dev` in apps/worker; /api is proxied so it is still one origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist", sourcemap: true },
});
