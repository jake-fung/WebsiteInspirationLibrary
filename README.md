# Website Inspiration Library

Local-only library for website design inspiration. Drop in an image, paste an
image URL, or paste a live site URL; Claude drafts a brief plus an
aesthetics / reference / intent prompt you can copy straight into a Claude Code
session to build a client site.

## Setup

```bash
npm install
npx playwright install chromium   # ~300MB, one time
cp .env.example .env              # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:5173

The app runs without an API key — capture and manual editing work normally,
only AI drafting is disabled.

### Paying for analysis

Two analyzers, selected by the `ANALYZER` env var:

| `ANALYZER` | How analysis runs | Billed to |
|---|---|---|
| unset (default) | One Anthropic API vision call | API credits, ~1–2¢ per inspiration |
| `claude-code` | Shells out to the `claude` CLI | Your Claude subscription |

`claude-code` mode needs Claude Code installed, `claude` on `PATH`, and an
active `claude` login; no `ANTHROPIC_API_KEY` is required. It is slower per
capture (a CLI process per analysis) and relies on prompt-level JSON discipline
rather than the API's schema enforcement, so a malformed reply surfaces as a
failed analysis you can retry.

## Capturing

| Input | What happens |
|---|---|
| Drop a PNG/JPG/WebP | Stored locally, analyzed |
| Paste an image URL | Downloaded, stored, analyzed |
| Paste a site URL | Playwright screenshots the live page and extracts real fonts, colours, and layout, which are fed to Claude as ground truth |

Analysis runs in the background — capture several references in a row without
waiting. Anything that fails shows a **retry analysis** button; the captured
image is never lost to an analysis failure.

## Notes

- Pinterest blocks direct image links. Drag the image in instead of pasting its URL.
- Data lives in `server/data/` (SQLite + images) and is gitignored.
- Each analysis is one Claude vision call — roughly a cent or two per inspiration.

## Tests

```bash
npm test
```

The capture suite launches a real Chromium against a local fixture; everything
else runs without network access.
