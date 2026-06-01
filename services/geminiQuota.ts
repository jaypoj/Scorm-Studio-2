export type GeminiQuotaEvent = {
  operation: string;
  model?: string;
  quotaMetric?: string;
  quotaLimit?: number;
  retryAfterSeconds?: number;
  isQuotaError: boolean;
  isFreeTierProjectQuota: boolean;
  message: string;
  recordedAt: string;
};

const QUOTA_STORAGE_KEY = 'scorm_gemini_quota_events';

const getErrorText = (error: unknown) => error instanceof Error ? error.message : String(error || '');

const readJsonFragments = (text: string) => {
  const fragments: any[] = [];
  const matches = text.match(/\{[\s\S]*\}/g) || [];
  for (const match of matches) {
    try {
      fragments.push(JSON.parse(match));
    } catch {
      // SDK error messages often include prose before/after JSON.
    }
  }
  return fragments;
};

const findQuotaFailure = (details: any[]): any => {
  for (const detail of details) {
    if (detail?.['@type']?.includes('QuotaFailure')) return detail;
    if (Array.isArray(detail?.details)) {
      const nested = findQuotaFailure(detail.details);
      if (nested) return nested;
    }
  }
  return null;
};

const findRetryDelay = (details: any[]): number | undefined => {
  for (const detail of details) {
    if (detail?.retryDelay) {
      const seconds = Number(String(detail.retryDelay).replace(/s$/, ''));
      if (Number.isFinite(seconds)) return seconds;
    }
    if (Array.isArray(detail?.details)) {
      const nested = findRetryDelay(detail.details);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

export const parseGeminiQuotaError = (error: unknown, operation: string, model?: string): GeminiQuotaEvent => {
  const message = getErrorText(error);
  const lower = message.toLowerCase();
  const fragments = readJsonFragments(message);
  const root = fragments[0]?.error || fragments[0] || {};
  const details = Array.isArray(root.details) ? root.details : [];
  const quotaFailure = findQuotaFailure(details);
  const violation = quotaFailure?.violations?.[0] || {};
  const quotaMetric = violation.quotaMetric || message.match(/generate_content_[a-z0-9_]+/i)?.[0];
  const quotaLimit = Number(violation.quotaValue || message.match(/limit:\s*(\d+)/i)?.[1]);
  const parsedModel = violation.quotaDimensions?.model || message.match(/model:\s*([a-z0-9.\-_]+)/i)?.[1] || model;
  const retryAfterSeconds = findRetryDelay(details) ?? Number(message.match(/retryDelay["']?:["']?(\d+)s/i)?.[1]);
  const isQuotaError = root.code === 429 || message.includes('"code":429') || lower.includes('quota exceeded') || lower.includes('resource_exhausted');
  const isFreeTierProjectQuota = lower.includes('free tier') || lower.includes('freetier') || String(quotaMetric || '').includes('free_tier');

  return {
    operation,
    model: parsedModel,
    quotaMetric,
    quotaLimit: Number.isFinite(quotaLimit) ? quotaLimit : undefined,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    isQuotaError,
    isFreeTierProjectQuota,
    message,
    recordedAt: new Date().toISOString(),
  };
};

export const recordGeminiQuotaEvent = (event: GeminiQuotaEvent) => {
  const existing = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) || '[]') as GeminiQuotaEvent[];
  localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify([event, ...existing].slice(0, 25)));
};

export const formatGeminiQuotaGuidance = (event: GeminiQuotaEvent) => {
  if (!event.isQuotaError) return event.message;
  const pieces = [
    'Gemini quota was exhausted for this Google Cloud project, not just this API key.',
    event.model ? `Model: ${event.model}.` : '',
    event.quotaLimit ? `Observed limit: ${event.quotaLimit} request${event.quotaLimit === 1 ? '' : 's'}.` : '',
    event.retryAfterSeconds ? `Google suggested retrying after about ${event.retryAfterSeconds} seconds.` : '',
    event.isFreeTierProjectQuota ? 'Free-tier Gemini image/transcription models are especially limited; completed pages were saved and the batch can be resumed later.' : 'Completed pages were saved and the batch can be resumed later.',
  ].filter(Boolean);
  return pieces.join(' ');
};
