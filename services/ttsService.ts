import { AISettings, PronunciationEntry, TtsSettings } from '../types';
import { DEFAULT_TTS_SETTINGS } from '../constants';
import { appEnv } from './env';

const AZURE_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const AZURE_OPENAI_API_VERSION = 'preview';
const TTS_INPUT_LIMIT = 4096;

type TtsErrorDetails = {
  status?: number;
  retryAfterSeconds?: number;
  code?: string;
  deploymentName?: string;
  source?: 'proxy' | 'direct';
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
  const base = endpoint.endsWith('/openai/v1') ? endpoint : `${endpoint}/openai/v1`;
  return `${base}/audio/speech?api-version=${encodeURIComponent(apiVersion)}`;
};

const getProxyUrl = (settings: Pick<AISettings, 'azureTtsProxyUrl'>) => {
  const configured = settings.azureTtsProxyUrl?.trim() || appEnv.azureTtsProxyUrl;
  return configured ? configured.replace(/\/+$/, '') : '';
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
  if (message.toLowerCase().includes('deployment') && message.toLowerCase().includes('does not exist')) {
    return `${fallbackAction} failed because Azure could not find the deployment named "${details?.deploymentName || AZURE_OPENAI_TTS_MODEL}". In AI Settings, set TTS Deployment / Model to the exact deployment name IT created for gpt-4o-mini-tts. If IT just created it, wait a few minutes and try again.\n\nProvider message: ${message}`;
  }
  return `${fallbackAction} failed because of "${message}"`;
};

const extractResponseError = async (response: Response, source: 'proxy' | 'direct') => {
  const retryAfterSeconds = Number(response.headers.get('retry-after')) || undefined;
  let message = `${source === 'proxy' ? 'Azure TTS proxy' : 'Azure OpenAI TTS'} returned HTTP ${response.status}.`;
  let code: string | undefined;
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      message = getAzureErrorMessage(body, message);
      code = stringifyErrorValue(body?.error?.code || body?.code) || undefined;
    } else {
      message = await response.text().catch(() => message) || message;
    }
  } catch {
    message = await response.text().catch(() => message) || message;
  }
  return { message, retryAfterSeconds, code };
};

const buildTtsPayload = (
  script: string,
  settings: AISettings,
  ttsSettings: TtsSettings,
) => ({
  input: script,
  model: settings.azureOpenAiTtsModel?.trim() || AZURE_OPENAI_TTS_MODEL,
  voice: ttsSettings.voiceName || DEFAULT_TTS_SETTINGS.voiceName,
  speed: paceToSpeed[ttsSettings.pace || DEFAULT_TTS_SETTINGS.pace],
  instructions: ttsSettings.styleInstructions || DEFAULT_TTS_SETTINGS.styleInstructions,
  response_format: 'wav',
});

export async function generateNarrationAudio(
  _settings: AISettings,
  narration: string,
  ttsSettings: TtsSettings = DEFAULT_TTS_SETTINGS,
  pronunciations: PronunciationEntry[] = []
): Promise<Blob> {
  const script = applyPronunciations(narration, pronunciations).trim();
  if (!script) throw new Error('Narration script is empty.');
  if (script.length > TTS_INPUT_LIMIT) {
    throw new Error(`Narration is ${script.length} characters after pronunciation replacements. Azure OpenAI TTS supports up to ${TTS_INPUT_LIMIT} characters per request.`);
  }

  const payload = buildTtsPayload(script, _settings, ttsSettings);
  const proxyUrl = getProxyUrl(_settings);
  const source: 'proxy' | 'direct' = proxyUrl ? 'proxy' : 'direct';

  if (!proxyUrl && !_settings.azureOpenAiApiKey?.trim()) {
    throw new Error('Missing Azure TTS proxy URL or Azure OpenAI API key. Add the proxy URL or paste a runtime key in AI Settings before generating TTS.');
  }

  const response = await fetch(proxyUrl || getAzureSpeechUrl(_settings), {
    method: 'POST',
    headers: proxyUrl
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json', 'api-key': _settings.azureOpenAiApiKey!.trim() },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const { message, retryAfterSeconds, code } = await extractResponseError(response, source);
    const deploymentName = _settings.azureOpenAiTtsModel?.trim() || AZURE_OPENAI_TTS_MODEL;
    throw buildTtsError(message, { status: response.status, retryAfterSeconds, code, deploymentName, source });
  }

  return response.blob();
}

export async function testNarrationAudioSettings(settings: AISettings): Promise<{
  message: string;
  sizeBytes: number;
}> {
  const blob = await generateNarrationAudio(
    settings,
    'Azure OpenAI text to speech settings test.',
    {
      ...DEFAULT_TTS_SETTINGS,
      styleInstructions: 'Read this short settings test clearly and neutrally.',
    },
    []
  );
  return {
    message: 'Azure OpenAI TTS settings worked. Test audio was generated successfully.',
    sizeBytes: blob.size,
  };
}
