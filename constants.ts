export const APP_NAME = "SCORM Architect Pro";
export const SIDEBAR_WIDTH = 280;

// Placeholder for demo purposes if Env var is missing (User should supply key)
export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Fast & Efficient)" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview (Complex Tasks, May Require Access/Billing)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Stable Pro)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Stable Fallback)" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (Lowest Cost)" },
];

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
