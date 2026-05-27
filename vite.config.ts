import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Emits dist/stats.html after `npm run build` so we can audit
      // which deps dominate the bundle. `gzipSize` + `brotliSize`
      // are slow-ish during build but harmless in CI/local.
      //
      // Set ANALYZE=1 to auto-open the report in your browser, or
      // ANALYZE=0 to skip entirely.
      // Cast: rollup-plugin-visualizer returns Rollup's plugin type
      // which doesn't perfectly line up with Vite's PluginOption (extra
      // hook surface). Cast through `unknown` keeps eslint happy.
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: process.env.ANALYZE === '1',
      }) as unknown as PluginOption,
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.ZAPCAP_API_KEY': JSON.stringify(env.ZAPCAP_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      // Code-split the production bundle. Without manualChunks the main
      // bundle reaches ~1.68MB (415KB gzipped) because every dependency
      // gets concatenated into a single file. Grouping heavy vendors
      // separately drops the initial parse cost and lets the browser
      // cache them across deploys.
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
            lucide: ['lucide-react'],
            motion: ['motion/react'],
            jspdf: ['jspdf'],
            // UX25-D4: split adicional pra reduzir initial bundle.
            // react-dom é o maior single dep depois de firebase/jspdf —
            // separar ele permite cache cross-deploy. html2canvas (~200KB)
            // só carrega quando user gera PDF — vale chunk próprio.
            'react-vendor': ['react', 'react-dom'],
            html2canvas: ['html2canvas'],
            'react-hot-toast': ['react-hot-toast'],
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});
