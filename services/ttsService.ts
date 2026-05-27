import { AISettings, PronunciationEntry, TtsSettings } from '../types';
import { DEFAULT_TTS_SETTINGS } from '../constants';

const AZURE_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const AZURE_OPENAI_API_VERSION = 'preview';
const TTS_INPUT_LIMIT = 4096;

type TtsErrorDetails = {
  status?: number;
  retryAfterSeconds?: number;
  code?: string;
};

type TtsError = Error & {
  ttsDetails?: TtsErrorDetails;
};

const paceToSpeed: Record<TtsSettings['pace'], number> = {
  'very-slow': 0.75,
  slow: 0.9,
  normal: 1,
  fast: 1.15,
  'very-fast': 1.3,
};

export const applyPronunciations = (script: string, pronunciations: PronunciationEntry[] = []) => {
  return pronunciations.reduce((current, entry) => {
    const term = entry.term.trim();
    const replacement = entry.replacement.trim();
    if (!term || !replacement) return current;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return current.replace(new RegExp(`\\b${escaped}\\b`, 'g'), replacement);
  }, script);
};

const getAzureSpeechUrl = (settings: Pick<AISettings, 'azureOpenAiEndpoint' | 'azureOpenAiApiVersion'>) => {
  const endpoint = settings.azureOpenAiEndpoint?.trim().replace(/\/+$/, '');
  if (!endpoint) throw new Error('Missing Azure OpenAI endpoint. Add it in AI Settings.');
  const apiVersion = settings.azureOpenAiApiVersion?.trim() || AZURE_OPENAI_API_VERSION;
  return `${endpoint}/openai/v1/audio/speech?api-version=${encodeURIComponent(apiVersion)}`;
};

const buildTtsError = (message: string, details: TtsErrorDetails = {}) => {
  const error = new Error(message) as TtsError;
  error.ttsDetails = details;
  return error;
};

const stringifyErrorValue = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const item = value as any;
    return item.message || item.error?.message || item.error || item.code || JSON.stringify(item);
  }
  return String(value);
};

const getAzureErrorMessage = (body: any, fallback: string) => {
  const candidates = [
    body?.error?.message,
    body?.error,
    body?.message,
    body?.detail,
    body?.details,
  ].map(stringifyErrorValue).filter(Boolean);
  return candidates[0] || fallback;
};

export const getTtsErrorDetails = (error: unknown) => (error as TtsError)?.ttsDetails;

export const isTtsQuotaError = (error: unknown) => {
  const details = getTtsErrorDetails(error);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return details?.status === 429 || message.includes('rate limit') || message.includes('quota') || message.includes('429');
};

export const formatTtsErrorForUser = (error: unknown, fallbackAction = 'Text-to-speech') => {
  const details = getTtsErrorDetails(error);
  const message = error instanceof Error ? error.message : String(error || 'Unknown error.');
  if (details?.status === 429) {
    return `Azure OpenAI TTS rate limit or quota was reached. Completed pages were saved and the batch can be resumed later.${details.retryAfterSeconds ? ` Retry after about ${details.retryAfterSeconds} seconds.` : ''}\n\n${message}`;
  }
  return `${fallbackAction} failed because of "${message}"`;
};

export async function generateNarrationAudio(
  _settings: AISettings,
  narration: string,
  ttsSettings: TtsSettings = DEFAULT_TTS_SETTINGS,
  pronunciations: PronunciationEntry[] = []
): Promise<Blob> {
  if (!_settings.azureOpenAiApiKey?.trim()) {
    throw new Error('Missing Azure OpenAI API key. Paste it in AI Settings before generating TTS.');
  }
  const script = applyPronunciations(narration, pronunciations).trim();
  if (!script) throw new Error('Narration script is empty.');
  if (script.length > TTS_INPUT_LIMIT) {
    throw new Error(`Narration is ${script.length} characters after pronunciation replacements. Azure OpenAI TTS supports up to ${TTS_INPUT_LIMIT} characters per request.`);
  }

  const response = await fetch(getAzureSpeechUrl(_settings), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': _settings.azureOpenAiApiKey.trim(),
    },
    body: JSON.stringify({
      input: script,
      model: _settings.azureOpenAiTtsModel?.trim() || AZURE_OPENAI_TTS_MODEL,
      voice: ttsSettings.voiceName || DEFAULT_TTS_SETTINGS.voiceName,
      speed: paceToSpeed[ttsSettings.pace || DEFAULT_TTS_SETTINGS.pace],
      instructions: ttsSettings.styleInstructions || DEFAULT_TTS_SETTINGS.styleInstructions,
      response_format: 'wav',
    }),
  });

  if (!response.ok) {
    const retryAfterSeconds = Number(response.headers.get('retry-after')) || undefined;
    let message = `Azure OpenAI TTS returned HTTP ${response.status}.`;
    let code: string | undefined;
    try {
      const body = await response.json();
      message = getAzureErrorMessage(body, message);
      code = stringifyErrorValue(body?.error?.code || body?.code) || undefined;
    } catch {
      message = await response.text().catch(() => message) || message;
    }
    throw buildTtsError(message, { status: response.status, retryAfterSeconds, code });
  }

  return response.blob();
}
