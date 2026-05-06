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

## Public browser preview with GitHub Pages

This app is static after `npm run build`, so GitHub Pages can host a public test URL. The workflow in `.github/workflows/pages.yml` builds the Vite app and deploys `dist/` to Pages.

### 1. Push this repo to GitHub

If this Codex workspace does not already have a remote, create an empty GitHub repository first, then run:

```bash
git remote add origin https://github.com/<OWNER>/<REPO>.git
git branch -M main
git push -u origin main
```

If the remote already exists, push the current branch to `main`:

```bash
git push origin HEAD:main
```

### 2. Enable GitHub Pages for Actions

In GitHub:

1. Open your repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Go to **Actions → Deploy static Vite app to GitHub Pages**.
5. Click **Run workflow** on `main`, or push another commit to `main`.

### 3. Open the public URL

After the workflow finishes, GitHub shows the live URL in the deployment summary. For a normal project repository, it will be:

```text
https://<OWNER>.github.io/<REPO>/
```

For a user/organization Pages repository named `<OWNER>.github.io`, it will be:

```text
https://<OWNER>.github.io/
```

The workflow automatically sets Vite's `base` path for either URL style.

### 4. Optional AI keys for the Pages preview

For UI testing, deploy without keys first. If you want AI features on the public Pages preview, add **restricted test keys** as repository secrets in **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret name | Used for |
| --- | --- |
| `VITE_GEMINI_API_KEY` | Gemini content generation, image generation, captions |
| `VITE_GOOGLE_SEARCH_API_KEY` | Google Custom Search and YouTube search |
| `VITE_GOOGLE_SEARCH_ENGINE_ID` | Programmable Search Engine image-search `cx` |

> Warning: because GitHub Pages is static, these values are baked into browser JavaScript. Only use restricted, disposable test keys. Do not put production secrets in a static Pages build.

## Codex Cloud / forwarded-port preview

Do not open `localhost` from your personal browser; `localhost` is inside the Codex Cloud container. For an in-browser Codex preview:

```bash
npm install
cp .env.example .env.local
npm run dev -- --host 0.0.0.0 --port 3000
```

Then use the Codex Cloud **Ports**, **Preview**, or **Open in browser** control for forwarded port `3000`. If Codex Cloud does not expose a forwarded port in your UI, use the GitHub Pages workflow above for a public URL.

Because browser preview frames cannot use the native File System Access picker, use **Sandbox Mode** in the welcome screen to upload a folder or files while testing in Codex Cloud.

## Project files

Open or upload a folder containing at least one `.scormproj` file. The app scans for a nearby `media`, `assets`, or `*_assets` folder and links it to the project. In sandbox mode, saves download an updated `.scormproj` file instead of writing back to disk.

## Development checks

```bash
npm run typecheck
npm run build
```
