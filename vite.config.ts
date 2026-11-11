import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Phone access via ngrok: one public origin serves the app and proxies the scraper API.
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app"],
    proxy: {
      "/scraper": { target: "http://127.0.0.1:3001", rewrite: (p) => p.replace(/^\/scraper/, "") },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@actions": path.resolve(__dirname, "./src/actions"),
    },
  },
})
