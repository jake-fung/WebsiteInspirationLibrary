# Website Inspiration Library — Design

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan

## Problem

Collecting website design inspiration is easy; making it *usable* is not. Screenshots pile up in folders and never get annotated, so when it's time to build a client site the reference material is a wall of images with no articulation of *why* each one works.

This tool closes that gap: drop in a reference, get an AI-drafted articulation of its aesthetics, reference points, and intent, then copy a structured prompt straight into a Claude Code session to build the real thing.

## Goals

- Capture inspiration in seconds — a dropped file, an image URL, or a live website URL
- Every inspiration carries a **brief** and a **copyable prompt** (aesthetics / reference / intent)
- Group by **design type**, where the type vocabulary grows from actual usage
- Output pastes cleanly into another Claude Code session

## Non-goals

- Multi-user, accounts, or hosting (local-only by decision)
- Multiple images per inspiration (single image; revisit if it becomes a real limitation)
- Clipboard paste ingest (`Cmd+V`) — not selected
- Emitting raw extracted data into the copy output (facts inform the prose, they aren't dumped)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | Local-only web app | Everything is on the machine where the prompts get used |
| Prompt authoring | AI-generated, user-editable | An un-annotated library is a dead library |
| Design types | AI-suggested, user-confirmed, free-form | Vocabulary fits the user's taste, not a fixed taxonomy |
| Ingest | Drop file, image URL, **site URL** | Site URL analyzes a real page, not a thumbnail |
| Site capture | Screenshot **+** extracted CSS facts | Real fonts and hexes beat guessing from pixels |
| Copy output | Structured markdown only | Self-contained prose; no file paths, no data blobs, no client slot |
| Stack | Vite + React, Express backend | Playwright and native modules work without bundler friction |
| Storage | `node:sqlite` (built into Node 24) + images folder | Zero dependencies, no native compile |
| Model | `claude-opus-5` | Vision + structured output |

### Rejected alternatives

- **Next.js** — Playwright needs `serverExternalPackages` config; heavy framework for a personal tool
- **Plain Node + server-rendered HTML** — the UI (drag-drop, grid, modal editor, live analysis states) is genuinely interactive
- **`better-sqlite3`** — `node:sqlite` is built in and needs no native build step
- **HTML/metadata-only site capture** — yields a marketing thumbnail, not the real design

## Architecture

```
inspiration-library/
├── server/
│   ├── index.js              Express app, static serving
│   ├── routes/
│   │   ├── inspirations.js   CRUD
│   │   ├── ingest.js         file upload | image URL | site URL
│   │   └── analyze.js        Claude vision call (+ retry)
│   ├── lib/
│   │   ├── db.js             node:sqlite schema + queries
│   │   ├── capture.js        Playwright screenshot + DOM fact extraction
│   │   ├── analyze.js        Anthropic SDK, structured output
│   │   └── prompt.js         assembles the copyable markdown
│   └── data/
│       ├── library.db
│       └── images/
├── src/                      React UI
└── .env                      ANTHROPIC_API_KEY
```

Run both processes under one `npm run dev` via `concurrently`, with Vite proxying `/api` to Express.

### Module boundaries

Each `lib/` module has one job, a narrow interface, and can be tested alone:

- **`capture.js`** — `captureSite(url) -> { imagePath, facts }`. Owns all Playwright. Knows nothing about the database or Claude.
- **`analyze.js`** — `analyze({ imagePath, facts }) -> { designType, brief, aesthetics, reference, intent }`. Owns all Anthropic API calls. Knows nothing about HTTP or storage.
- **`prompt.js`** — `toMarkdown(inspiration) -> string`. Pure function. The single source of truth for copy-output shape.
- **`db.js`** — all SQL. No other module writes queries.

## Data flow

Three ingest paths converge on the same shape: **a local image file, plus optional extracted facts.**

| Input | Path |
|---|---|
| Dropped file | copy into `data/images/<id>.<ext>` |
| Image URL | fetch → validate content-type → save → same |
| Site URL | Playwright loads page → full-page screenshot → save; extract DOM facts |

Then: image (base64) + facts → `claude-opus-5` vision call → validated JSON.

**URL disambiguation:** the capture bar sniffs a pasted URL — image file extension or an image `Content-Type` on a HEAD request routes to the image path; everything else routes to Playwright site capture.

### Extracted facts (site URL only)

From the live DOM after render:

- Computed `font-family` stacks actually in use, with sizes for headings vs body
- Color palette — background, text, and accent hexes by frequency of use
- Layout structure — nav pattern, section rhythm, grid vs stacked

Facts are passed to Claude as ground truth so the generated prose is concrete. They are stored on the record but **not** emitted in the copy output.

### Analysis contract

Structured output via `output_config.format` with a `json_schema`, so the response is validated at the API layer rather than parsed hopefully:

```json
{
  "designType": "string",
  "title": "string",
  "brief": "string",
  "aesthetics": "string",
  "reference": "string",
  "intent": "string"
}
```

`max_tokens: 16000`, non-streaming (well within HTTP timeout for a response this size).

### Schema

```sql
CREATE TABLE inspirations (
  id              TEXT PRIMARY KEY,
  design_type     TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  source_url      TEXT,
  image_path      TEXT NOT NULL,
  brief           TEXT NOT NULL DEFAULT '',
  aesthetics      TEXT NOT NULL DEFAULT '',
  reference       TEXT NOT NULL DEFAULT '',
  intent          TEXT NOT NULL DEFAULT '',
  extracted_facts TEXT,                        -- JSON, nullable
  status          TEXT NOT NULL DEFAULT 'analyzing',  -- analyzing | ready | failed
  error           TEXT,
  created_at      TEXT NOT NULL
);
```

Design types are **not** a separate table — `SELECT DISTINCT design_type` builds the sidebar, so the vocabulary grows from what is actually saved and never drifts out of sync.

## UI

```
┌──────────────────────────────────────────────────────────┐
│  ⌘ Drop an image, or paste a URL…                        │  ← always visible
├───────────────┬──────────────────────────────────────────┤
│ All (47)      │  ┌────────┐ ┌────────┐ ┌────────┐        │
│               │  │        │ │        │ │ ◌ analy│        │
│ Editorial (12)│  │        │ │        │ │  zing… │        │
│ Brutalist (8) │  └────────┘ └────────┘ └────────┘        │
│ SaaS Landing  │  Kinfolk     Linear      (pending)       │
│ Portfolio (6) │  Editorial   SaaS                        │
└───────────────┴──────────────────────────────────────────┘
```

**Ingest is non-blocking.** The card appears as soon as the image is saved, in an `analyzing` state, and fills in when Claude returns. Several captures can be in flight at once.

**Detail view** — large image left; editable fields right: design type (free-text with autocomplete over existing types), title, brief, aesthetics, reference, intent. Every field is editable at all times — Claude drafts, the user owns. One **Copy prompt** button.

### Copy output

```markdown
# <title>

<brief>

## Aesthetics
<aesthetics>

## Reference
<reference>

## Intent
<intent>
```

## Error handling

**Core principle: capture and analysis fail independently.** A saved image is never lost because Claude was unreachable.

| Failure | Behavior |
|---|---|
| No `ANTHROPIC_API_KEY` | App runs fully. Ingest saves the image, fields blank, dismissible banner explains how to enable drafting. Manual entry always works. |
| Chromium not installed | Capture error returns the exact fix: `npx playwright install chromium` |
| Site URL times out / bot-walled | No record created; error suggests screenshotting manually and dropping the file |
| Image URL returns 403 | Named explicitly: "Pinterest blocks direct image links; drag the image in instead" |
| Image URL wrong content-type | Rejected before writing to disk |
| Malformed JSON from Claude | Record saved with `status='failed'`; fields blank; **Retry analysis** available |
| `stop_reason: "refusal"` | Surfaced plainly, not swallowed into a generic error |

Every inspiration exposes **Retry analysis**, so a transient failure costs one click, not a re-capture.

## Testing

- **Unit** — `prompt.js` markdown shape (exact output); `capture.js` fact extraction against a fixture HTML page; `db.js` queries
- **Integration** — all three ingest paths against a stubbed Anthropic client and a fixture page served by Express itself, so the suite needs no network
- **Manual** — one real Pinterest image, one real site URL

## Known costs

- **Playwright pulls ~300MB of Chromium** on first install. The one heavy dependency; accepted as the price of the site-URL feature.
- **Each analysis is one Opus vision call** — roughly a cent or two per inspiration. Negligible for a personal library, but a per-item rather than flat cost.

## Prerequisites

1. Node 24+ (for built-in `node:sqlite`) — confirmed present
2. `ANTHROPIC_API_KEY` in `.env` — **not currently set on this machine**
3. `npx playwright install chromium` after `npm install`
