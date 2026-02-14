import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read root .env so frontend proxy follows the backend PORT setting.
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT || '3010';

  return {
    plugins: [react()],
    root: './client',
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
