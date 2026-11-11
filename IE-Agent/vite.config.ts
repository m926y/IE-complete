import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [".muleusercontent.com"],
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
  },
});
