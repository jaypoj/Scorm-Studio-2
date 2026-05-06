import { GoogleGenAI, createPartFromBase64 } from '@google/genai';
import { AISettings, Question, Topic } from '../types';
import { DEFAULT_GEMINI_MODEL } from '../constants';
import { requireGeminiApiKey } from './env';

const getClient = () => new GoogleGenAI({ apiKey: requireGeminiApiKey() });
const getModel = (settings?: AISettings) => settings?.model || DEFAULT_GEMINI_MODEL;

const stripJsonFences = (value: string) => value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

async function generateJson<T>(settings: AISettings, prompt: string): Promise<T> {
  const response = await getClient().models.generateContent({
    model: getModel(settings),
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response.');

  return JSON.parse(stripJsonFences(text)) as T;
}

export async function generateTopicContent(settings: AISettings, title: string, sourceText: string): Promise<Partial<Topic>> {
  return generateJson<Partial<Topic>>(settings, `Create SCORM lesson topic content from this source material.
Return only JSON with: title, content (semantic HTML), narration, duration (minutes), imagePrompts (string array), and knowledgeCheck.questions (2-3 multiple-choice Question objects with id, type, question, options, correctAnswer, feedback.correct, feedback.incorrect).

Topic title: ${title}

Source material:
${sourceText}`);
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
  const response = await getClient().models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt,
    config: { numberOfImages: 1 },
  });

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageBytes) throw new Error('Gemini did not return generated image bytes.');
  return imageBytes;
}

export async function transcribeAudioToVTT(file: File): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read audio file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });

  const response = await getClient().models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: [
      createPartFromBase64(base64, file.type || 'audio/mp3'),
      { text: 'Transcribe this audio as valid WebVTT captions. Return only the WEBVTT file content.' },
    ],
  });

  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned an empty transcription.');
  return text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`;
}
