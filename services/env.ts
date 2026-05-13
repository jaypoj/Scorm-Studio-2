declare const __APP_ENV__: {
  GEMINI_API_KEY?: string;
  GEMINI_FALLBACK_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  CUSTOM_GEMINI_API_KEY?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_ENGINE_ID?: string;
  PIXABAY_API_KEY?: string;
};

const env = typeof __APP_ENV__ === 'object' && __APP_ENV__ ? __APP_ENV__ : {};

export const appEnv = {
  geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.CUSTOM_GEMINI_API_KEY || '',
  geminiFallbackApiKey: env.GEMINI_FALLBACK_API_KEY || '',
  googleSearchApiKey: env.GOOGLE_SEARCH_API_KEY || env.CUSTOM_GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
  googleSearchEngineId: env.GOOGLE_SEARCH_ENGINE_ID || '',
  pixabayApiKey: env.PIXABAY_API_KEY || '',
};

export const getGeminiApiKeys = () => {
  const keys = [
    env.GEMINI_API_KEY,
    env.GEMINI_FALLBACK_API_KEY,
    env.CUSTOM_GEMINI_API_KEY,
    env.GOOGLE_API_KEY,
  ].filter(Boolean) as string[];

  return Array.from(new Set(keys));
};

export const hasGeminiApiKey = () => Boolean(appEnv.geminiApiKey);

export const requireGeminiApiKey = () => {
  if (!appEnv.geminiApiKey) {
    throw new Error('Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local and restart npm run dev.');
  }

  return appEnv.geminiApiKey;
};
