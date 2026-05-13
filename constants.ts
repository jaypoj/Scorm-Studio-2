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
  voiceName: "Kore",
  pace: "normal" as const,
};

export const GEMINI_TTS_VOICES = [
  "Kore",
  "Puck",
  "Charon",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];

export const TTS_PACE_OPTIONS = [
  { value: "very-slow", label: "Very Slow" },
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
  { value: "very-fast", label: "Very Fast" },
];
