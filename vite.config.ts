import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeBasePath = (basePath: string) => {
  if (!basePath) return '/';
  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const appEnv = {
    GEMINI_API_KEY: env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.CUSTOM_GEMINI_API_KEY || '',
    GEMINI_FALLBACK_API_KEY: env.VITE_GEMINI_FALLBACK_API_KEY || env.GEMINI_FALLBACK_API_KEY || '',
    GOOGLE_API_KEY: env.VITE_GOOGLE_API_KEY || env.GOOGLE_API_KEY || '',
    CUSTOM_GEMINI_API_KEY: env.VITE_CUSTOM_GEMINI_API_KEY || env.CUSTOM_GEMINI_API_KEY || '',
    GOOGLE_SEARCH_API_KEY: env.VITE_GOOGLE_SEARCH_API_KEY || env.GOOGLE_SEARCH_API_KEY || '',
    GOOGLE_SEARCH_ENGINE_ID: env.VITE_GOOGLE_SEARCH_ENGINE_ID || env.GOOGLE_SEARCH_ENGINE_ID || '',
    PIXABAY_API_KEY: env.VITE_PIXABAY_API_KEY || env.PIXABAY_API_KEY || '',
    AZURE_TTS_PROXY_URL: env.VITE_AZURE_TTS_PROXY_URL || env.AZURE_TTS_PROXY_URL || '',
  };

  return {
    base: normalizeBasePath(env.VITE_BASE_PATH || '/'),
    server: {
      port: 3000,
      host: '0.0.0.0',
      strictPort: true,
    },
    preview: {
      port: 4173,
      host: '0.0.0.0',
      strictPort: true,
    },
    plugins: [react()],
    define: {
      __APP_ENV__: JSON.stringify(appEnv),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
