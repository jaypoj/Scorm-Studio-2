import { GoogleGenAI, createPartFromBase64 } from '@google/genai';
import JSZip from 'jszip';
import { AISettings, AiRateLimitLevel, CourseContent, PronunciationEntry, Question, Topic, TtsSettings } from '../types';
import { DEFAULT_GEMINI_MODEL } from '../constants';
import { getGeminiApiKeys, requireGeminiApiKey } from './env';

const getClient = (apiKey = requireGeminiApiKey()) => new GoogleGenAI({ apiKey });
const getModel = (settings?: AISettings) => settings?.model || DEFAULT_GEMINI_MODEL;
const IMAGE_GENERATION_MODEL = 'gemini-2.5-flash-image';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_MIN_INTERVAL_MS = 4100;
let lastTtsRequestAt = 0;
let lastTranscriptionRequestAt = 0;
const TRANSCRIPTION_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  DEFAULT_GEMINI_MODEL,
];

const stripJsonFences = (value: string) => value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

async function withGeminiFallback<T>(operation: (client: GoogleGenAI) => Promise<T>): Promise<T> {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) {
    throw new Error('Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local and restart npm run dev.');
  }

  let lastError: unknown;
  for (const apiKey of apiKeys) {
    try {
      return await operation(getClient(apiKey));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed for all configured API keys.');
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const throttleTts = async () => {
  const elapsed = Date.now() - lastTtsRequestAt;
  if (elapsed < TTS_MIN_INTERVAL_MS) await sleep(TTS_MIN_INTERVAL_MS - elapsed);
  lastTtsRequestAt = Date.now();
};

const throttleTranscription = async () => {
  const elapsed = Date.now() - lastTranscriptionRequestAt;
  if (elapsed < TTS_MIN_INTERVAL_MS) await sleep(TTS_MIN_INTERVAL_MS - elapsed);
  lastTranscriptionRequestAt = Date.now();
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

const getPaceInstruction = (pace: TtsSettings['pace']) => {
  switch (pace) {
    case 'very-slow': return 'Use a very slow, careful instructional pace.';
    case 'slow': return 'Use a slow, clear instructional pace.';
    case 'fast': return 'Use a brisk but understandable training pace.';
    case 'very-fast': return 'Use a very brisk pace while keeping words intelligible.';
    default: return 'Use a steady, natural training pace.';
  }
};

const base64ToBytes = (base64: string) => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
  return new Uint8Array(byteNumbers);
};

const pcmToWav = (pcmBytes: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16) => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, pcmBytes.length, true);

  return new Blob([header, pcmBytes], { type: 'audio/wav' });
};

const COURSE_GENERATION_LIMITS: Record<AiRateLimitLevel, { delayMs: number; maxTextChars: number; maxBinaryFileBytes: number; maxTotalBinaryBytes: number }> = {
  '0': { delayMs: 8000, maxTextChars: 12000, maxBinaryFileBytes: 0, maxTotalBinaryBytes: 0 },
  some: { delayMs: 5000, maxTextChars: 25000, maxBinaryFileBytes: 750_000, maxTotalBinaryBytes: 1_500_000 },
  medium: { delayMs: 2500, maxTextChars: 60000, maxBinaryFileBytes: 1_500_000, maxTotalBinaryBytes: 3_000_000 },
  most: { delayMs: 1000, maxTextChars: 120000, maxBinaryFileBytes: 3_000_000, maxTotalBinaryBytes: 8_000_000 },
  full: { delayMs: 0, maxTextChars: 240000, maxBinaryFileBytes: 8_000_000, maxTotalBinaryBytes: 20_000_000 },
};

const TEXT_REFERENCE_EXTENSIONS = new Set(['txt', 'csv', 'json', 'rtf', 'md', 'markdown', 'html', 'htm']);
const SUPPORTED_INLINE_BINARY_EXTENSIONS = new Set(['pdf']);

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

const decodeXmlText = (value: string) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const readDocxText = async (file: File) => {
  const zip = await JSZip.loadAsync(file);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  return documentXml ? decodeXmlText(documentXml) : '';
};

const readXlsxText = async (file: File) => {
  const zip = await JSZip.loadAsync(file);
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)).map(match => decodeXmlText(match[0]))
    : [];
  const sheetFiles = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).slice(0, 8);
  const rows: string[] = [];

  for (const sheetName of sheetFiles) {
    const xml = await zip.file(sheetName)?.async('string');
    if (!xml) continue;
    const values = Array.from(xml.matchAll(/<c[^>]*(?:t="s")?[^>]*>[\s\S]*?<v>(.*?)<\/v>[\s\S]*?<\/c>/g)).map(match => {
      const raw = match[1] || '';
      return sharedStrings[Number(raw)] || raw;
    });
    if (values.length > 0) rows.push(`${sheetName}: ${values.join(' | ')}`);
  }

  return rows.join('\n');
};

const tryReadStructuredText = async (file: File, extension: string) => {
  try {
    if (extension === 'docx') return await readDocxText(file);
    if (extension === 'xlsx') return await readXlsxText(file);
  } catch (error) {
    console.warn(`Could not extract ${file.name}.`, error);
  }
  return '';
};

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const readReferenceParts = async (files: File[], rateLimit: AiRateLimitLevel = 'medium') => {
  const limits = COURSE_GENERATION_LIMITS[rateLimit] || COURSE_GENERATION_LIMITS.medium;
  const parts: any[] = [];
  const summaries: string[] = [];
  let usedTextChars = 0;
  let usedBinaryBytes = 0;

  for (const file of files) {
    const extension = getFileExtension(file.name);
    const isTextLike = file.type.startsWith('text/') || TEXT_REFERENCE_EXTENSIONS.has(extension);
    const structuredText = !isTextLike ? await tryReadStructuredText(file, extension) : '';

    if ((isTextLike || structuredText) && usedTextChars < limits.maxTextChars) {
      const remainingChars = limits.maxTextChars - usedTextChars;
      const text = (structuredText || await file.text()).slice(0, remainingChars);
      usedTextChars += text.length;
      summaries.push(`Included text from ${file.name}: ${text.length} characters.`);
      parts.push({ text: `\n\nREFERENCE DOCUMENT: ${file.name}\n${text}` });
      continue;
    }

    if (SUPPORTED_INLINE_BINARY_EXTENSIONS.has(extension) && limits.maxBinaryFileBytes > 0 && file.size <= limits.maxBinaryFileBytes && usedBinaryBytes + file.size <= limits.maxTotalBinaryBytes) {
      const base64 = await fileToBase64(file);
      usedBinaryBytes += file.size;
      summaries.push(`Attached ${file.name}: ${Math.round(file.size / 1024)} KB.`);
      parts.push(createPartFromBase64(base64, file.type || 'application/octet-stream'));
      continue;
    }

    summaries.push(`Skipped or summarized ${file.name}: ${Math.round(file.size / 1024)} KB exceeds the selected limit or cannot be extracted locally.`);
  }

  return {
    parts,
    summary: summaries.length > 0 ? summaries.join('\n') : 'No reference documents were provided.',
    delayMs: limits.delayMs,
  };
};

const getCourseModelFallbacks = (selectedModel: string) => Array.from(new Set([
  selectedModel,
  DEFAULT_GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]));

async function generateContentWithModelFallback(settings: AISettings, contents: any, config?: any) {
  let lastError: unknown;
  for (const model of getCourseModelFallbacks(getModel(settings))) {
    try {
      return await withGeminiFallback(client => client.models.generateContent({ model, contents, config }));
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Gemini model ${model} failed. Trying fallback if available.`, message);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini request failed for all model fallbacks.');
}

const isTemporaryGeminiError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":503') ||
    message.includes('"code":429') ||
    message.includes('UNAVAILABLE') ||
    message.toLowerCase().includes('quota exceeded') ||
    message.toLowerCase().includes('high demand');
};

async function generateJson<T>(settings: AISettings, prompt: string): Promise<T> {
  const response = await withGeminiFallback(client => client.models.generateContent({
    model: getModel(settings),
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  }));

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response.');

  return JSON.parse(stripJsonFences(text)) as T;
}

export async function generateTopicContent(settings: AISettings, title: string, sourceText: string): Promise<Partial<Topic>> {
  return generateJson<Partial<Topic>>(settings, `Create SCORM lesson topic content from this source material.
Return only JSON with: title, content (semantic HTML), narration, duration (minutes), imagePrompts (string array), and knowledgeCheck.questions (2-3 multiple-choice Question objects with id, type, question, options, correctAnswer, feedback.correct, feedback.incorrect).

HTML formatting rules:
- Use real semantic lists: <ul><li>...</li></ul> or <ol><li>...</li></ol>. Do not fake bullets with hyphens, asterisks, <br>, or plain text.
- Nest sub-bullets only inside the parent <li>, and keep indentation structurally valid.
- Use real HTML tables for comparisons, standards, measurements, workflows, or responsibilities: <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>.
- Do not create pseudo-tables with spaces, tabs, pipes, or line breaks.
- Keep each table compact with clear column headers and concise cell text.

Topic title: ${title}

Source material:
${sourceText}`);
}

export async function generateCourseContent(
  settings: AISettings,
  courseTitle: string,
  topics: string[],
  difficulty: number,
  referenceFiles: File[] = [],
  rateLimit: AiRateLimitLevel = 'medium'
): Promise<CourseContent> {
  const referenceContext = await readReferenceParts(referenceFiles, rateLimit);
  if (referenceContext.delayMs > 0) await sleep(referenceContext.delayMs);

  const prompt = `Create a complete SCORM course content JSON object for this course.

Course title: ${courseTitle}
Difficulty: ${difficulty}/5
Reference document handling:
${referenceContext.summary}

Topics:
${topics.map((topic, index) => `${index + 1}. ${topic}`).join('\n')}

Return only valid JSON matching this TypeScript shape:
{
  "welcomePage": {"id":"welcome","title":"","content":"","narration":"","duration":3,"imageKeywords":[],"imagePrompts":[],"videoSearchTerms":[],"media":[]},
  "learningObjectivesPage": {"id":"learning-objectives","title":"Learning Objectives","content":"","narration":"","duration":3,"imageKeywords":[],"imagePrompts":[],"videoSearchTerms":[],"media":[]},
  "topics": [{"id":"topic-0","title":"","content":"","narration":"","duration":5,"imageKeywords":[],"imagePrompts":[],"videoSearchTerms":[],"media":[],"knowledgeCheck":{"questions":[{"id":"","type":"multiple-choice","question":"","options":["","","",""],"correctAnswer":"","feedback":{"correct":"","incorrect":""}}]}}],
  "assessment": {"narration":null,"passMark":80,"questions":[{"id":"","type":"multiple-choice","question":"","options":["","","",""],"correctAnswer":"","feedback":{"correct":"","incorrect":""}}]}
}

Rules:
- Include welcomePage and learningObjectivesPage exactly once.
- Create exactly one page for every listed topic, using sequential IDs topic-0, topic-1, topic-2.
- Every topic must have exactly one multiple-choice knowledge check with four options.
- Final assessment must have exactly 10 questions, multiple-choice only, no true-false and no fill-in-the-blank.
- Content fields must be semantic HTML fragments using h2, h3, p, ul, ol, li, table, tr, td, th where useful.
- Use real semantic lists: <ul><li>...</li></ul> or <ol><li>...</li></ol>. Do not fake bullets with hyphens, asterisks, <br>, or plain text.
- Nest sub-bullets only inside the parent <li>, and keep indentation structurally valid.
- Use real HTML tables for comparisons, standards, measurements, workflows, responsibilities, or decision criteria: <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>.
- Do not create pseudo-tables with spaces, tabs, pipes, or line breaks. Every table must have visible column headers and concise cell text.
- Do not include bulletPoints.
- Narration is one string per non-assessment page and must be under 1000 characters.
- Image keywords, image prompts, and video search terms must be specific to each page.
- Use ASCII punctuation only. Do not use markdown fences, JSON comments, LaTeX, smart quotes, em dashes, or trailing commas.
- For math or symbols, use HTML entities or plain Unicode inside HTML. Use <sup> and <sub> for exponents/subscripts.
- Use the supplied reference documents as source material when relevant, but do not quote long passages.`;

  const response = await generateContentWithModelFallback(settings, [{ text: prompt }, ...referenceContext.parts], {
    responseMimeType: 'application/json',
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty course response.');
  return JSON.parse(stripJsonFences(text)) as CourseContent;
}

export async function generateDistractors(settings: AISettings, question: string, correctAnswer: string, contextText = ''): Promise<string[]> {
  const result = await generateJson<{ distractors: string[] }>(settings, `Write three plausible but incorrect multiple-choice distractors.
Return only JSON: {"distractors":["...","...","..."]}

Question: ${question}
Correct answer: ${correctAnswer}
Context: ${contextText.slice(0, 6000)}`);

  return Array.isArray(result.distractors) ? result.distractors : [];
}

export async function researchTerm(settings: AISettings, term: string, contextText = ''): Promise<{ definition: string; expansion: string }> {
  return generateJson<{ definition: string; expansion: string }>(settings, `Explain this term for an e-learning course.
Return only JSON with definition (plain text) and expansion (short HTML paragraph/list).

Term: ${term}
Course context: ${contextText.slice(0, 6000)}`);
}

export async function generateImageFromPrompt(prompt: string): Promise<string> {
  const response: any = await withGeminiFallback(client => client.models.generateContent({
    model: IMAGE_GENERATION_MODEL,
    contents: prompt,
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  }));

  const imageBytes =
    response?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data)?.inlineData?.data ||
    response?.parts?.find((part: any) => part.inlineData?.data)?.inlineData?.data;

  if (!imageBytes) throw new Error('Gemini did not return generated image bytes.');
  return imageBytes;
}

export async function generateNarrationAudio(
  settings: AISettings,
  narration: string,
  ttsSettings: TtsSettings = { voiceName: 'Kore', pace: 'normal' },
  pronunciations: PronunciationEntry[] = []
): Promise<Blob> {
  const script = applyPronunciations(narration, pronunciations).trim();
  if (!script) throw new Error('Narration script is empty.');
  await throttleTts();

  const response: any = await withGeminiFallback(client => client.models.generateContent({
    model: TTS_MODEL,
    contents: [{
      text: `Read this e-learning narration clearly and professionally. ${getPaceInstruction(ttsSettings.pace)}\n\n${script}`,
    }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: ttsSettings.voiceName,
          },
        },
      },
    },
  }));

  const part =
    response?.candidates?.[0]?.content?.parts?.find((item: any) => item.inlineData?.data) ||
    response?.parts?.find((item: any) => item.inlineData?.data);
  const audioBase64 = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType || '';
  if (!audioBase64) throw new Error('Gemini TTS did not return audio.');

  const audioBytes = base64ToBytes(audioBase64);
  return mimeType.includes('wav')
    ? new Blob([audioBytes], { type: 'audio/wav' })
    : pcmToWav(audioBytes);
}

export async function transcribeAudioToVTT(file: File): Promise<string> {
  await throttleTranscription();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read audio file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });

  const uniqueModels = Array.from(new Set(TRANSCRIPTION_MODELS));
  let lastError: unknown;
  for (const model of uniqueModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await withGeminiFallback(client => client.models.generateContent({
          model,
          contents: [
            createPartFromBase64(base64, file.type || 'audio/mp3'),
            { text: 'Transcribe this audio as valid WebVTT captions with timestamps. Return only the WEBVTT file content.' },
          ],
        }));

        const text = response.text?.trim();
        if (!text) throw new Error(`Gemini returned an empty transcription from ${model}.`);
        return text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`;
      } catch (error) {
        lastError = error;
        if (!isTemporaryGeminiError(error)) break;
        await sleep(1200 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Caption generation failed for all transcription models.');
}
