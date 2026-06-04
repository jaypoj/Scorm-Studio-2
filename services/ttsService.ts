import { AISettings, PronunciationEntry, TtsSettings } from '../types';
import { DEFAULT_TTS_SETTINGS } from '../constants';

const AZURE_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const AZURE_OPENAI_API_VERSION = 'preview';
const AZURE_OPENAI_DEPLOYMENT_API_VERSION = '2025-04-01-preview';
const TTS_INPUT_LIMIT = 4096;

type TtsErrorDetails = {
  status?: number;
  statusText?: string;
  retryAfterSeconds?: number;
  code?: string;
  providerMessage?: string;
  url?: string;
  attemptedModel?: string;
  attemptedDeployment?: string;
  rawProviderResponseBody?: string;
  parsedProviderError?: unknown;
  requestIds?: Record<string, string>;
  requestDiagnostics?: {
    timestamp: string;
    action: 'text-to-speech narration';
    method: 'POST';
    url: string;
    attemptedModel: string;
    attemptedDeployment: string;
    voice: string;
    responseFormat: string;
    inputTextLength: number;
    sanitizedHeaders: Record<string, string>;
  };
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
  timestamp: string;
  model: string;
  deployment: string;
  voice: string;
  responseFormat: string;
  inputTextLength: number;
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

const extractProviderError = (parsedProviderError: unknown) => {
  const payload = parsedProviderError as any;
  const errorPayload = payload?.error || payload;
  return {
    code: errorPayload?.code || payload?.code,
    message: errorPayload?.message || errorPayload?.error || payload?.message,
  };
};

const getAzureRequestIds = (headers: Headers) => {
  const ids: Record<string, string> = {};
  [
    'x-request-id',
    'x-ms-request-id',
    'apim-request-id',
    'request-id',
    'operation-id',
  ].forEach(header => {
    const value = headers.get(header);
    if (value) ids[header] = value;
  });
  return ids;
};

const buildRequestDiagnostics = (request: AzureSpeechRequest): NonNullable<TtsErrorDetails['requestDiagnostics']> => ({
  timestamp: request.timestamp,
  action: 'text-to-speech narration',
  method: 'POST',
  url: request.url,
  attemptedModel: request.model,
  attemptedDeployment: request.deployment,
  voice: request.voice,
  responseFormat: request.responseFormat,
  inputTextLength: request.inputTextLength,
  sanitizedHeaders: {
    'Content-Type': 'application/json',
    'api-key': '[redacted]',
  },
});

export const getTtsErrorDetails = (error: unknown) => (error as TtsError)?.ttsDetails;

export const isTtsQuotaError = (error: unknown) => {
  const details = getTtsErrorDetails(error);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return details?.status === 429 || message.includes('rate limit') || message.includes('quota') || message.includes('429');
};

export const formatTtsErrorForUser = (error: unknown, fallbackAction = 'Text-to-speech') => {
  const details = getTtsErrorDetails(error);
  const message = error instanceof Error ? error.message : String(error || 'Unknown error.');
  const attempted = [
    details?.attemptedModel ? `Attempted model: ${details.attemptedModel}` : '',
    details?.attemptedDeployment ? `Attempted deployment: ${details.attemptedDeployment}` : '',
  ].filter(Boolean).join('\n');
  const azureMismatch = message.includes('gpt-4o-mini-transcribe')
    && !details?.attemptedModel?.includes('transcribe')
    && !details?.attemptedDeployment?.includes('transcribe')
      ? '\n\nAzure reported gpt-4o-mini-transcribe even though this app requested TTS. That means the Azure deployment/resource/key is still resolving to a transcribe-backed deployment or IT provided the wrong Azure resource.'
      : '';
  const diagnostic = attempted ? `\n\n${attempted}${azureMismatch}` : azureMismatch;
  if (details?.status === 429) {
    return `Azure OpenAI TTS rate limit or quota was reached. Completed pages were saved and the batch can be resumed later.${details.retryAfterSeconds ? ` Retry after about ${details.retryAfterSeconds} seconds.` : ''}\n\n${message}${diagnostic}`;
  }
  return `${fallbackAction} failed because of "${message}"${diagnostic}`;
};

export const buildTtsDiagnosticReport = (error: unknown, action = 'Text-to-speech') => {
  const details = getTtsErrorDetails(error);
  const rawMessage = error instanceof Error ? error.message : String(error || 'Unknown error.');
  const requestDiagnostics = details?.requestDiagnostics;
  const parsedProviderError = details?.parsedProviderError
    ? JSON.stringify(details.parsedProviderError, null, 2)
    : '(not parsed or not JSON)';
  const lines = [
    'SCORM Architect Azure OpenAI TTS Diagnostic Report',
    `Generated: ${new Date().toISOString()}`,
    `Action: ${action}`,
    '',
    'User-facing message:',
    formatTtsErrorForUser(error, action),
    '',
    'Raw provider/app error:',
    rawMessage,
    '',
    'Raw Azure provider response body:',
    details?.rawProviderResponseBody || '(not captured)',
    '',
    'Parsed provider error JSON:',
    parsedProviderError,
    '',
    'Request diagnostics:',
    `Timestamp: ${requestDiagnostics?.timestamp || '(not captured)'}`,
    `Action: ${requestDiagnostics?.action || action}`,
    `HTTP method: ${requestDiagnostics?.method || 'POST'}`,
    `Request URL: ${requestDiagnostics?.url || details?.url || '(not captured)'}`,
    `Attempted model: ${requestDiagnostics?.attemptedModel || details?.attemptedModel || '(not captured)'}`,
    `Attempted deployment: ${requestDiagnostics?.attemptedDeployment || details?.attemptedDeployment || '(not captured)'}`,
    `Voice: ${requestDiagnostics?.voice || '(not captured)'}`,
    `Response format: ${requestDiagnostics?.responseFormat || '(not captured)'}`,
    `Input text length: ${requestDiagnostics?.inputTextLength ?? '(not captured)'}`,
    `Sanitized headers: ${JSON.stringify(requestDiagnostics?.sanitizedHeaders || { 'api-key': '[redacted]' }, null, 2)}`,
    '',
    'Response diagnostics:',
    `HTTP status: ${details?.status ?? '(not captured)'}`,
    `HTTP status text: ${details?.statusText || '(not captured)'}`,
    `Azure/OpenAI request IDs: ${JSON.stringify(details?.requestIds || {}, null, 2)}`,
    `Provider code: ${details?.code || '(not captured)'}`,
    `Provider message: ${details?.providerMessage || '(not captured)'}`,
    `Retry after seconds: ${details?.retryAfterSeconds ?? '(none)'}`,
    '',
    'Important interpretation:',
    rawMessage.includes('gpt-4o-mini-transcribe') && !details?.attemptedModel?.includes('transcribe') && !details?.attemptedDeployment?.includes('transcribe')
      ? 'Azure reported gpt-4o-mini-transcribe even though this app attempted gpt-4o-mini-tts. This indicates the Azure deployment/resource/key is still resolving to a transcribe-backed deployment or the wrong Azure resource was provided.'
      : 'If the raw provider error names a different model than the attempted model/deployment above, the mismatch is coming from Azure or the provided Azure resource/deployment, not from the SCORM Architect client code.',
    '',
    'Security note:',
    'This report intentionally does not include the Azure API key.',
  ];
  if (typeof navigator !== 'undefined') lines.push('', `Browser: ${navigator.userAgent}`);
  return lines.join('\n');
};

const buildAzureSpeechRequests = (
  settings: Pick<AISettings, 'azureOpenAiEndpoint' | 'azureOpenAiApiVersion' | 'azureOpenAiTtsModel'>,
  baseBody: Record<string, unknown>,
): AzureSpeechRequest[] => {
  const endpoint = parseAzureEndpoint(settings);
  const voice = String(baseBody.voice || DEFAULT_TTS_SETTINGS.voiceName);
  const responseFormat = String(baseBody.response_format || 'wav');
  const inputTextLength = String(baseBody.input || '').length;
  const timestamp = new Date().toISOString();
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
      timestamp,
      model: endpoint.model,
      deployment: endpoint.deployment,
      voice,
      responseFormat,
      inputTextLength,
    },
  ];

  const deploymentUrl = `${endpoint.resourceRoot}/openai/deployments/${encodeURIComponent(endpoint.deployment)}/audio/speech?api-version=${encodeURIComponent(endpoint.deploymentApiVersion)}`;
  if (!candidates.some(candidate => candidate.url === deploymentUrl)) {
    candidates.push({
      label: 'Azure OpenAI deployment audio speech',
      url: deploymentUrl,
      body: deploymentBody,
      timestamp,
      model: endpoint.model,
      deployment: endpoint.deployment,
      voice,
      responseFormat,
      inputTextLength,
    });
  }

  return candidates;
};

const parseTtsResponseError = async (response: Response, request: AzureSpeechRequest) => {
  const retryAfterSeconds = Number(response.headers.get('retry-after')) || undefined;
  const rawProviderResponseBody = await response.text();
  let parsedProviderError: unknown;
  try {
    parsedProviderError = rawProviderResponseBody ? JSON.parse(rawProviderResponseBody) : undefined;
  } catch {
    parsedProviderError = undefined;
  }
  const provider = extractProviderError(parsedProviderError);
  const message = provider.message || rawProviderResponseBody || `Azure OpenAI TTS returned HTTP ${response.status}.`;
  return buildTtsError(message, {
    status: response.status,
    statusText: response.statusText,
    retryAfterSeconds,
    code: provider.code,
    providerMessage: provider.message,
    url: request.url,
    attemptedModel: request.model,
    attemptedDeployment: request.deployment,
    rawProviderResponseBody,
    parsedProviderError,
    requestIds: getAzureRequestIds(response.headers),
    requestDiagnostics: buildRequestDiagnostics(request),
  });
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

      lastError = await parseTtsResponseError(response, request);
      if (![404, 405, 410].includes(response.status)) throw lastError;
    } catch (error) {
      if (getTtsErrorDetails(error)?.status) throw error;
      const message = error instanceof Error ? error.message : String(error || 'Unknown network error.');
      lastError = buildTtsError(
        `${request.label} could not be reached from this browser. If this is the deployed GitHub Pages app, check browser DevTools for a CORS/preflight error and use an Azure Function/API proxy if Azure does not allow direct browser calls. Also verify the endpoint is the Azure OpenAI endpoint, usually https://<resource>.openai.azure.com or a copied URL ending in /openai/v1. Details: ${message}`,
        {
          url: request.url,
          attemptedModel: request.model,
          attemptedDeployment: request.deployment,
          requestDiagnostics: buildRequestDiagnostics(request),
        },
      );
    }
  }

  throw lastError || buildTtsError('Azure OpenAI TTS request failed before a response was received.');
}
