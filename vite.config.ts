import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';

// The PDF engine is a separate import; its worker and resources stay local/offline.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-pdf-resources',
      closeBundle() {
        mkdirSync('dist/pdf', { recursive: true });
        for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
          cpSync(`node_modules/pdfjs-dist/${directory}`, `dist/pdf/${directory}`, {
            recursive: true,
          });
        }
      },
      configureServer(server) {
        server.middlewares.use('/pdf', async (req, res, next) => {
          const { readFile } = await import('node:fs/promises');
          const path = (req.url ?? '').split('?')[0];
          if (!/^\/(cmaps|standard_fonts|wasm)\/[\w.-]+$/.test(path)) return next();
          try {
            const data = await readFile(`node_modules/pdfjs-dist${path}`);
            if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
            res.end(data);
          } catch {
            next();
          }
        });
      },
    },
  ],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { target: 'safari16.4' },
});
