export const APP_NAME = "SCORM Architect Pro";
export const SIDEBAR_WIDTH = 280;

// Placeholder for demo purposes if Env var is missing (User should supply key)
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

// Text-generation model IDs verified against Google's Gemini API models and pricing documentation.
// Free-tier access depends on the specific API project's eligibility and quota.
export const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Latest, Free Tier)" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Free Tier)" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Free Tier, Efficient)" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (Free Tier, Legacy Fallback)" },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (Paid Tier Only)" },
];

// Keep older saved model IDs visible to the user rather than silently changing settings.
export const getGeminiModelOptions = (currentModel?: string) => currentModel && !GEMINI_MODEL_OPTIONS.some(option => option.value === currentModel)
  ? [{ value: currentModel, label: `Previously saved: ${currentModel} (verify availability)` }, ...GEMINI_MODEL_OPTIONS]
  : GEMINI_MODEL_OPTIONS;

export const DEFAULT_TTS_SETTINGS = {
  voiceName: "coral",
  pace: "normal" as const,
  styleInstructions: "Read as clear, professional e-learning narration for adult technical training. Keep the tone confident, calm, and easy to follow.",
};

export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

export const TTS_PACE_OPTIONS = [
  { value: "very-slow", label: "Very Slow" },
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
  { value: "very-fast", label: "Very Fast" },
];
