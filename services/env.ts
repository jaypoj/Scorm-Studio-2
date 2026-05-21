import type { AISettings } from '../types';

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

export const getGeminiApiKeys = (settings?: Pick<AISettings, 'geminiApiKey' | 'geminiFallbackApiKey' | 'googleSearchApiKey' | 'allowBundledGeminiFallback'>) => {
  const runtimeKeys = [
    settings?.geminiApiKey,
    settings?.geminiFallbackApiKey,
  ].filter(Boolean) as string[];

  if (!settings?.allowBundledGeminiFallback) {
    return Array.from(new Set(runtimeKeys));
  }

  const keys = [
    ...runtimeKeys,
    env.GEMINI_API_KEY,
    env.GEMINI_FALLBACK_API_KEY,
    env.CUSTOM_GEMINI_API_KEY,
    env.GOOGLE_API_KEY,
    settings?.googleSearchApiKey,
  ].filter(Boolean) as string[];

  return Array.from(new Set(keys));
};

export const hasGeminiApiKey = (settings?: Pick<AISettings, 'geminiApiKey' | 'geminiFallbackApiKey' | 'googleSearchApiKey' | 'allowBundledGeminiFallback'>) => Boolean(getGeminiApiKeys(settings)[0]);

export const requireGeminiApiKey = (settings?: Pick<AISettings, 'geminiApiKey' | 'geminiFallbackApiKey' | 'googleSearchApiKey' | 'allowBundledGeminiFallback'>) => {
  const key = getGeminiApiKeys(settings)[0] || (settings?.allowBundledGeminiFallback ? appEnv.geminiApiKey : '');
  if (!key) {
    throw new Error('Missing Gemini API key. Add one in AI Settings.');
  }

  return key;
};
