const DEFAULT_ENDPOINT = 'https://jstrungis-9161-resource.openai.azure.com/openai/v1';
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_API_VERSION = 'preview';
const DEFAULT_MAX_RPM = 6;
const DEFAULT_CONCURRENCY = 1;
const INPUT_LIMIT = 4096;
const VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]);

let activeRequests = 0;
const pendingRequests = [];
const requestTimestamps = [];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const normalizeEndpoint = (endpoint) => {
  const trimmed = String(endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  return trimmed.endsWith('/openai/v1') ? trimmed : `${trimmed}/openai/v1`;
};

const speechUrl = () => {
  const endpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
  const apiVersion = encodeURIComponent(process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION);
  return `${endpoint}/audio/speech?api-version=${apiVersion}`;
};

const corsHeaders = (origin) => {
  const configured = (process.env.ALLOWED_ORIGINS || 'https://jaypoj.github.io')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const allowedOrigin = configured.includes('*')
    ? '*'
    : configured.includes(origin)
      ? origin
      : configured[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
};

const jsonResponse = (context, origin, status, body, extraHeaders = {}) => {
  context.res = {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body,
  };
};

const parseAzureError = async (response) => {
  const fallback = `Azure OpenAI TTS returned HTTP ${response.status}.`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const body = JSON.parse(text);
      return body?.error?.message || body?.message || body?.detail || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
};

const waitForRateSlot = async () => {
  const maxRpm = numberFromEnv('AZURE_TTS_MAX_RPM', DEFAULT_MAX_RPM);
  const now = Date.now();
  while (requestTimestamps.length && now - requestTimestamps[0] >= 60000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length < maxRpm) {
    requestTimestamps.push(Date.now());
    return;
  }
  const waitMs = Math.max(1000, 60000 - (now - requestTimestamps[0]));
  await sleep(waitMs);
  await waitForRateSlot();
};

const runQueued = (task) => new Promise((resolve, reject) => {
  pendingRequests.push({ task, resolve, reject });
  drainQueue();
});

const drainQueue = () => {
  const maxConcurrency = numberFromEnv('AZURE_TTS_CONCURRENCY', DEFAULT_CONCURRENCY);
  while (activeRequests < maxConcurrency && pendingRequests.length) {
    const next = pendingRequests.shift();
    activeRequests += 1;
    next.task()
      .then(next.resolve, next.reject)
      .finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
  }
};

const validateRequest = (body) => {
  const input = String(body?.input || '').trim();
  const voice = String(body?.voice || 'coral').trim();
  const speed = Number(body?.speed ?? 1);
  const instructions = String(body?.instructions || '').trim();

  if (!process.env.AZURE_OPENAI_API_KEY) {
    return { error: 'Azure OpenAI API key is not configured on the Function app.' };
  }
  if (!input) return { error: 'Missing narration input.' };
  if (input.length > INPUT_LIMIT) return { error: `Narration input is ${input.length} characters. Azure OpenAI TTS supports up to ${INPUT_LIMIT} characters.` };
  if (!VOICES.has(voice)) return { error: `Unsupported voice "${voice}".` };
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) return { error: 'Speed must be a number between 0.25 and 4.' };

  return { input, voice, speed, instructions };
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: corsHeaders(req.headers.origin),
    };
    return;
  }

  const validation = validateRequest(req.body);
  if (validation.error) {
    jsonResponse(context, req.headers.origin, 400, { error: { message: validation.error } });
    return;
  }

  try {
    const result = await runQueued(async () => {
      await waitForRateSlot();
      const azureResponse = await fetch(speechUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.AZURE_OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: process.env.AZURE_OPENAI_TTS_MODEL || DEFAULT_MODEL,
          input: validation.input,
          voice: validation.voice,
          speed: validation.speed,
          instructions: validation.instructions,
          response_format: 'wav',
        }),
      });

      if (!azureResponse.ok) {
        const message = await parseAzureError(azureResponse);
        return {
          ok: false,
          status: azureResponse.status,
          retryAfter: azureResponse.headers.get('retry-after'),
          body: { error: { message } },
        };
      }

      return {
        ok: true,
        body: Buffer.from(await azureResponse.arrayBuffer()),
      };
    });

    if (!result.ok) {
      jsonResponse(
        context,
        req.headers.origin,
        result.status,
        result.body,
        result.retryAfter ? { 'Retry-After': result.retryAfter } : {}
      );
      return;
    }

    context.res = {
      status: 200,
      headers: {
        ...corsHeaders(req.headers.origin),
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
      },
      body: result.body,
    };
  } catch (error) {
    context.log.error('Azure TTS proxy failed without logging request text or audio bytes.', error?.message || error);
    jsonResponse(context, req.headers.origin, 500, { error: { message: 'Azure TTS proxy failed. Check Function app settings and logs.' } });
  }
};
