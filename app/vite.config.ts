import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { andremovThemeScript } from '@andremov/brand/theme-script';

// Same security headers as production (vercel.json), so `vite preview` exercises the CSP.
const prodHeaders = Object.fromEntries(
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers[0].headers.map(
    (h: { key: string; value: string }) => [h.key, h.value],
  ),
);

// The brand's no-flash theme script has to run before the first paint, but the CSP allows no
// inline script (script-src 'self'). So it is a same-origin file, written from the package on every
// build (it never drifts from the library), and loaded by a blocking <script src> first in <head>.
const THEME_FILE = 'andremov-theme.js';
function themeScript(): Plugin {
  return {
    name: 'andremov-theme-script',
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: `./${THEME_FILE}` }, injectTo: 'head-prepend' }],
    configureServer(server) {
      server.middlewares.use(`/${THEME_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(andremovThemeScript);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: THEME_FILE, source: andremovThemeScript });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), themeScript()],
  base: './',
  preview: { headers: prodHeaders },
});
