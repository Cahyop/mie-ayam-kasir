// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        includeAssets: [
          "favicon.png",
          "apple-touch-icon.png",
          "pwa-192.png",
          "pwa-512.png",
          "pwa-maskable-512.png",
        ],
        manifest: {
          name: "POS Mie Ayam",
          short_name: "POS Mie Ayam",
          description:
            "Aplikasi kasir Mie Ayam: jualan, cetak struk Bluetooth, kirim struk WhatsApp, kelola kas, stok, dan pelanggan. Bisa dipakai offline.",
          theme_color: "#4a2410",
          background_color: "#faf3e0",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/pwa-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,svg,png,ico,woff2}"],
          runtimeCaching: [
            {
              // App HTML navigations: network first so published updates land,
              // but the last copy is served when the phone is offline.
              // /~oauth must always hit the network.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "pos-navigations",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // Same-origin static assets are content-hashed — cache first.
              urlPattern: ({ request, url }) =>
                url.origin === self.location.origin &&
                ["script", "style", "font", "image"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "pos-assets",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
  },
});
