import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Same security headers as production (vercel.json), so `vite preview` exercises the CSP.
const prodHeaders = Object.fromEntries(
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers[0].headers.map(
    (h: { key: string; value: string }) => [h.key, h.value],
  ),
);

export default defineConfig({
  plugins: [react()],
  base: './',
  preview: { headers: prodHeaders },
});
