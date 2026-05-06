# SCORM Architect Pro

A Vite + React editor for SCORM course projects exported from Google AI Studio. It supports project loading, sandboxed browser testing in Codex Cloud, Gemini-assisted content utilities, media search, and SCORM 1.2 package export.

## Where to put Google keys and secrets

1. Copy the example environment file:

   ```bash
   cp .env.example .env.local
   ```

2. Put your local/test keys in `.env.local`:

   ```bash
   VITE_GEMINI_API_KEY=your_google_ai_studio_gemini_key
   VITE_GOOGLE_SEARCH_API_KEY=your_google_cloud_search_youtube_key
   VITE_GOOGLE_SEARCH_ENGINE_ID=your_programmable_search_engine_cx
   ```

3. Restart `npm run dev` after changing `.env.local`.

> Important: this is currently a browser-only Vite app, so any `VITE_*` key is embedded in the browser test build. Use restricted Google Cloud/API keys for development: limit HTTP referrers where practical, enable only the APIs needed, set quota limits, and rotate keys before production. For production, move Gemini/Search calls behind a server API proxy so secrets are never shipped to users.

### Key purpose

| Variable | Required | Used for |
| --- | --- | --- |
| `VITE_GEMINI_API_KEY` | Yes for AI features | Gemini topic generation, distractors, research, image generation, audio captions |
| `VITE_GOOGLE_SEARCH_API_KEY` | Optional | Google Custom Search image results and YouTube Data API video search |
| `VITE_GOOGLE_SEARCH_ENGINE_ID` | Optional | Programmable Search Engine `cx` for Google image search |

Legacy AI Studio names (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `CUSTOM_GEMINI_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`) are also read by `vite.config.ts`, but new local work should use the `VITE_*` names above.

## Run in Codex Cloud / browser preview

```bash
npm install
cp .env.example .env.local
npm run dev -- --host 0.0.0.0 --port 3000
```

Open the forwarded Codex Cloud port for `3000`. Because browser preview frames cannot use the native File System Access picker, use **Sandbox Mode** in the welcome screen to upload a folder or files while testing in Codex Cloud.

## Project files

Open or upload a folder containing at least one `.scormproj` file. The app scans for a nearby `media`, `assets`, or `*_assets` folder and links it to the project. In sandbox mode, saves download an updated `.scormproj` file instead of writing back to disk.

## Development checks

```bash
npm run typecheck
npm run build
```
