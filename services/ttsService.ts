import { AISettings, PronunciationEntry, TtsSettings } from '../types';
import { DEFAULT_TTS_SETTINGS } from '../constants';

const AZURE_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const AZURE_OPENAI_API_VERSION = 'preview';
const AZURE_OPENAI_DEPLOYMENT_API_VERSION = '2025-04-01-preview';
const TTS_INPUT_LIMIT = 4096;

type TtsErrorDetails = {
  status?: number;
  retryAfterSeconds?: number;
  code?: string;
  url?: string;
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

type AzureSpeechRequest = {
  url: string;
  body: Record<string, unknown>;
  label: string;
};

const parseAzureEndpoint = (settings: Pick<AISettings, 'azureOpenAiEndpoint' | 'azureOpenAiApiVersion' | 'azureOpenAiTtsModel'>) => {
  const endpoint = settings.azureOpenAiEndpoint?.trim().replace(/\/+$/, '');
  if (!endpoint) throw new Error('Missing Azure OpenAI endpoint. Add it in AI Settings.');
  const configuredModelOrDeployment = settings.azureOpenAiTtsModel?.trim();
  const model = configuredModelOrDeployment || AZURE_OPENAI_TTS_MODEL;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Azure OpenAI endpoint must be a valid HTTPS URL, such as https://your-resource.openai.azure.com.');
  }
  if (url.protocol !== 'https:') throw new Error('Azure OpenAI endpoint must start with https://.');

  const apiVersion = settings.azureOpenAiApiVersion?.trim() || AZURE_OPENAI_API_VERSION;
  const deploymentApiVersion = apiVersion === 'preview' || apiVersion === 'v1'
    ? AZURE_OPENAI_DEPLOYMENT_API_VERSION
    : apiVersion;
  const path = url.pathname.replace(/\/+$/, '');
  const deploymentMatch = path.match(/\/openai\/deployments\/([^/]+)/i);
  const endpointDeployment = deploymentMatch?.[1] ? decodeURIComponent(deploymentMatch[1]) : '';
  const deployment = configuredModelOrDeployment || endpointDeployment || AZURE_OPENAI_TTS_MODEL;
  const openAiV1Index = path.toLowerCase().indexOf('/openai/v1');
  const isProjectEndpoint = path.toLowerCase().includes('/api/projects/');
  const resourceRootPath = path.toLowerCase().includes('/openai/')
    ? path.slice(0, path.toLowerCase().indexOf('/openai/'))
    : '';
  const resourceRoot = `${url.origin}${resourceRootPath}`;
  const v1Base = openAiV1Index >= 0
    ? `${resourceRoot}/openai/v1`
    : isProjectEndpoint
      ? `${url.origin}${path}/openai/v1`
      : `${resourceRoot}/openai/v1`;

  return {
    endpoint,
    model,
    deployment,
    apiVersion,
    deploymentApiVersion,
    resourceRoot,
    v1Base,
  };
};

const buildTtsError = (message: string, details: TtsErrorDetails = {}) => {
  const error = new Error(message) as TtsError;
  error.ttsDetails = details;
  return error;
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

const buildAzureSpeechRequests = (
  settings: Pick<AISettings, 'azureOpenAiEndpoint' | 'azureOpenAiApiVersion' | 'azureOpenAiTtsModel'>,
  baseBody: Record<string, unknown>,
): AzureSpeechRequest[] => {
  const endpoint = parseAzureEndpoint(settings);
  const v1Body = {
    ...baseBody,
    model: endpoint.model,
  };
  const deploymentBody = { ...baseBody };
  delete deploymentBody.model;

  const candidates: AzureSpeechRequest[] = [
    {
      label: 'Azure OpenAI v1 audio speech',
      url: `${endpoint.v1Base}/audio/speech?api-version=${encodeURIComponent(endpoint.apiVersion)}`,
      body: v1Body,
    },
  ];

  const deploymentUrl = `${endpoint.resourceRoot}/openai/deployments/${encodeURIComponent(endpoint.deployment)}/audio/speech?api-version=${encodeURIComponent(endpoint.deploymentApiVersion)}`;
  if (!candidates.some(candidate => candidate.url === deploymentUrl)) {
    candidates.push({
      label: 'Azure OpenAI deployment audio speech',
      url: deploymentUrl,
      body: deploymentBody,
    });
  }

  return candidates;
};

const parseTtsResponseError = async (response: Response, url: string) => {
  const retryAfterSeconds = Number(response.headers.get('retry-after')) || undefined;
  let message = `Azure OpenAI TTS returned HTTP ${response.status}.`;
  let code: string | undefined;
  try {
    const body = await response.json();
    const errorPayload = body.error || body;
    message = errorPayload.message || errorPayload.error || body.message || message;
    code = errorPayload.code || body.code;
  } catch {
    message = await response.text().catch(() => message) || message;
  }
  return buildTtsError(message, { status: response.status, retryAfterSeconds, code, url });
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

  const baseBody = {
    input: script,
    voice: ttsSettings.voiceName || DEFAULT_TTS_SETTINGS.voiceName,
    speed: paceToSpeed[ttsSettings.pace || DEFAULT_TTS_SETTINGS.pace],
    instructions: ttsSettings.styleInstructions || DEFAULT_TTS_SETTINGS.styleInstructions,
    response_format: 'wav',
  };
  const requests = buildAzureSpeechRequests(_settings, baseBody);
  let lastError: TtsError | null = null;

  for (const request of requests) {
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': _settings.azureOpenAiApiKey.trim(),
        },
        body: JSON.stringify(request.body),
      });

      if (response.ok) return response.blob();

      lastError = await parseTtsResponseError(response, request.url);
      if (![404, 405, 410].includes(response.status)) throw lastError;
    } catch (error) {
      if (getTtsErrorDetails(error)?.status) throw error;
      const message = error instanceof Error ? error.message : String(error || 'Unknown network error.');
      lastError = buildTtsError(
        `${request.label} could not be reached from this browser. If this is the deployed GitHub Pages app, check browser DevTools for a CORS/preflight error and use an Azure Function/API proxy if Azure does not allow direct browser calls. Also verify the endpoint is the Azure OpenAI endpoint, usually https://<resource>.openai.azure.com or a copied URL ending in /openai/v1. Details: ${message}`,
        { url: request.url },
      );
    }
  }

  throw lastError || buildTtsError('Azure OpenAI TTS request failed before a response was received.');
}
