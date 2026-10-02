import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import vinext from 'vinext';
import { defineConfig } from 'vite';
try {
  process.loadEnvFile('.env');
} catch {}
/**
 * Sem modo: o app no Node (npm run dev, npm run build, G:\MercePOC-prod).
 * `--mode cloudflare`: Worker + Durable Object (npm run cf:dev, cf:deploy),
 * com `#platform` apontando para lib/platform/worker.ts.
 */
export default defineConfig(({ mode }) =>
  mode === 'cloudflare'
    ? {
        plugins: [
          vinext(),
          cloudflare({
            configPath: './cloudflare/wrangler.jsonc',
            viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
          }),
        ],
        css: { postcss: { plugins: [tailwindcss()] } },
        resolve: { alias: { '#platform': fileURLToPath(new URL('./lib/platform/worker.ts', import.meta.url)) } },
        server: { host: '127.0.0.1', port: 4311, strictPort: true },
      }
    : {
        plugins: [vinext()],
        css: { postcss: { plugins: [tailwindcss()] } },
        server: { host: '127.0.0.1', port: 4310, strictPort: true },
      },
);
