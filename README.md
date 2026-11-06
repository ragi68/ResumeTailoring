# Resume Tailor (Chrome extension)

A personal Chrome extension (Manifest V3) that tailors your master resume to a job description and
attaches the result straight to the application's file upload.

- The PDF is generated **in memory** (a `Blob`), previewed in the side panel, and attached through a
  content script. Nothing is written to disk unless you click **Download** or drag the file out.
- The extension **never submits** an application.
- The LLM only **selects and orders** content from your master resume by ID. It cannot add experience,
  skills, or metrics. Optional rewrites are shown as accept/reject diffs, and an honesty check discards
  any that add numbers, tools, or claims.

It does not write cover letters, autofill forms, or do anything beyond tailoring and attaching the resume.

## Setup

Requirements: Node 20+ (developed on Node 24), npm, and Chrome 116+.

```bash
npm install          # also runs `wxt prepare`
npm run build        # production build in .output/chrome-mv3
```

Load it unpacked:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
4. Pin **Resume Tailor** to the toolbar. Clicking it opens the side panel.

Add your API key:

1. Click ⚙ in the panel (or open the extension's **Options**), then go to **Settings → Anthropic API**.
2. Paste your key (`sk-ant-…`) and click **Save key**. It is stored only in `chrome.storage.local` on this device.
3. Optional: change the models. Defaults are `claude-sonnet-5-5` for tailoring and rewrites, and
   `claude-haiku-5-5` for job-description analysis. Clear a field to go back to its default.

For development, `npm run dev` starts WXT with hot reload in a separate Chrome profile.

## Try it

A sample master resume (a fictional person) is loaded on first run, so you can try everything right away.

1. Open a job posting or application page, for example on `jobs.lever.co`, `boards.greenhouse.io` /
   `job-boards.greenhouse.io`, `jobs.ashbyhq.com`, or `*.myworkdayjobs.com`.
2. Open the side panel and click **+ New**.
3. **Tailor** tab: click **Capture from page**. If nothing is found, highlight the description on the
   page and click **Use selected text**, or paste it into the box.
4. Click **Analyze & tailor**. The resume is then trimmed to fit your page limit.
5. Review and adjust:
   - **Edit**: drag ⠿ or use ↑/↓ to reorder roles, projects, and bullets. Use the checkboxes to
     include or exclude, ☆ to pin an item (always included), and add or remove skills.
   - **Keywords**: chips show each JD keyword as covered (green), coverable from your existing content
     (amber, click for a one-click fix), or "no supported place" (red). Under them, **Suggest rewrites**
     offers diffs you accept or reject one by one.
   - **Preview** (or the right-hand column in the expanded view): the PDF rendered from the exact bytes
     that get attached, a "Fits on 1 page" indicator, **Fit to 1 page**, and an **ATS text** toggle that
     shows what a parser would extract.
6. Go to the application's upload step and click **Attach to application**. Check the form, then submit
   it yourself.

Fallbacks when attaching fails: **⇲ Drag file** (drag it onto the page's upload area or your desktop),
**Copy text**, and **Download**.

Edit the master resume in **Options → Master resume**. It supports JSON import/export and resetting to the sample.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Production build → `.output/chrome-mv3` |
| `npm run build:e2e` | Test build → `.output/chrome-mv3-e2e` (same, plus `http://localhost/*` pre-granted) |
| `npm test` | Vitest unit tests (selection application, ID repair, trimming, keyword aliases, adapters on fixtures, mocked-API pipeline, PDF output) |
| `npm run compile` | `tsc --noEmit` (strict) |
| `npm run e2e` | Real Chromium via Playwright: attach on the local test page (plain / hidden / drop zone / iframe), plus JD capture and attach on the four ATS fixtures served at their real URLs, embedded Greenhouse, and the delayed Workday upload step |
| `npm run e2e:tailor` | Full tailoring flow with the Anthropic API mocked at the network layer, ending with the tailored PDF attached |
| `npm run e2e:ui` | Editor, drag-and-drop, preview, fit, and side panel ↔ expanded tab sync |
| `npm run e2e:errors` | Error states: missing API key, rejected key (401), no job page |
| `npm run smoke` | Loads the production build; checks pages render and master edits persist and sync |
| `npm run testpage` | Serves `test-pages/attach-test.html` on `http://localhost:5179` for manual checks |

The e2e scripts need Playwright's Chromium once: `npx playwright install chromium`. Run `npm run build:e2e`
before `e2e` / `e2e:tailor`, and `npm run build` before `e2e:ui` / `smoke`.

## How it works

```
side panel / expanded tab (React, Zustand)            background service worker
  master + selections in chrome.storage.local  ──msg──▶  LLM_ANALYZE / LLM_SELECT / LLM_REWRITE
  pdfmake → Blob → pdf.js preview + ATS text              fetch → api.anthropic.com (Zod-validated)
  Attach ──base64──▶ content script (all frames)
                       site adapter: findUploadTarget → attachFile
```

- **Data** (`src/lib/schemas.ts`): Zod schemas with stable IDs for the header, experience, projects
  (a pool), skills with aliases, education, summary variants, and a per-job `Selection`. A selection
  holds ordered blocks with ordered `{id, included}` bullets, shown skill IDs, the summary choice,
  per-job text overrides (accepted rewrites), and the job metadata (JD text, source, analysis). It
  never modifies the master.
- **Pipeline** (`src/lib/llm/`):
  1. Analyze: JD → `{title, company, seniority, domain, requiredSkills, niceToHaves, keywords}`.
  2. Select: analysis + master (with IDs) → `{summaryId, blocks[{refId, bulletIds}], skillIds}`.
  3. `repairPlan` drops or re-homes every ID not in the master and lists the changes under
     "Notes from tailoring".
  4. `applyPlan` → Selection (pins forced in).
  5. Fit to the page limit.
- **Page length** (`src/lib/budget.ts`, `src/lib/fit.ts`): per-section line budgets (one page by default,
  doubled for two). Bullets are scored by JD relevance ×3 for required terms, plus a metric bonus and a
  position bonus. The trimmer drops the lowest-scoring unpinned bullet first, keeps at least one bullet
  per included role, and then confirms against the real PDF page count.
- **PDF** (`src/lib/pdf/resumeDoc.ts`): real text, single column, no tables, images, or vector graphics.
  Bullets are a literal "•" character, headings are Summary / Experience / Projects / Skills / Education,
  dates use one format ("Mar 2021 – Present"), and Roboto is embedded. Letter size.
- **Adapters** (`src/lib/adapters/`): one interface, `getJobDescription()`, `findUploadTarget()`,
  `attachFile(file)`, chosen by hostname with a generic fallback. Attaching sets `input.files` through the
  native `HTMLInputElement.prototype` setter and dispatches bubbling `input` and `change` events. If there
  is no input, it simulates `dragenter/dragover/drop` on the upload zone.
- **Messaging** (`src/lib/messaging.ts`, `src/lib/backgroundApi.ts`): typed request/response maps for
  panel ↔ background ↔ content script. Errors cross as `{ok:false, error}`.

## Assumptions and decisions

- **"Per-block ordered bulletIds"** is stored as an ordered list of `{id, included}` so excluded bullets
  keep their place and can be toggled back on.
- **Pins** live in a global list (not per job and not in the master), so "always include" applies to
  every job without changing master content.
- **Education** is always included by the pipeline. You can exclude it by hand.
- **Skills** can only be added from the master. The panel's "new skill" box adds the skill to the
  master first, because you are the source of truth.
- **Selected text vs. page capture**: "Capture from page" follows the requested order (JSON-LD, then site
  selectors, then selection). "Use selected text" uses only your selection.
- **API calls** use `fetch` from the background worker with `anthropic-dangerous-direct-browser-access: true`
  and structured JSON output (`output_config.format`). If a configured model rejects `effort`, the
  output format, or `fallbacks`, the call is retried without that parameter. On Claude Sonnet 5.5 / Opus
  5.x the request also sets `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so a
  safety-classifier refusal is retried on a fallback model instead of failing. A refusal that still comes
  back is shown as an error.
- **Host permissions**: in addition to the four ATS hosts, `https://api.anthropic.com/*` is listed so the
  worker can call the API. Other sites use the optional `https://*/*` / `http://*/*` permission,
  requested per site on first use. If Chrome hides the tab's URL (no access yet), the request has to be
  for all sites.
- **Content scripts** are registered statically in all frames on the ATS hosts, and injected on demand
  (all frames) elsewhere. A frame registry lets the panel reach an ATS iframe (e.g. Greenhouse embedded
  on a company site) without access to the company's domain.
- **Rewrites** are per-job overrides. The master text is never changed. You can revert each one on the
  Edit tab.
- The sample resume and all fixtures are fictional.

## Known limitations

- **Live sites are not covered by automated tests.** The adapters are tested against synthetic fixtures
  that copy each ATS's markup, served at the real URLs in Chromium. Real pages change, so check a live
  posting before relying on a site; see [docs/TESTING-LIVE.md](docs/TESTING-LIVE.md).
- **Framework-managed uploads**: setting `input.files` works for plain and React inputs in testing, but
  some upload widgets only accept a real OS file dialog or upload through their own flow. Synthetic
  drops can't be confirmed by the extension, so check that the page shows the file. Use the drag or
  download fallbacks if not.
- **Workday** requires signing in and is multi-step. Click attach on the step that has the resume
  upload. The adapter waits up to 8 s for it to render.
- **Side panel width** can't be set programmatically. Drag the panel edge, or use **Expand**.
- **Drag file** onto another web page depends on Chrome passing the file across. Dragging to the desktop
  (`DownloadURL`) is reliable.
- **Line budgets** are estimates calibrated to this layout. The fit indicator and **Fit to page** use the
  real PDF page count. Very long single bullets or summaries can still overflow if everything is pinned.
- **Keyword matching** is lexical: aliases from your skills, plus light stemming. It won't know that
  "led" means "leadership". Add aliases or alternates to your master to teach it.
- **Paper size** is US Letter.
- No icon artwork beyond a generated placeholder.

## Project layout

```
src/
  entrypoints/        background.ts, content.ts, sidepanel/, options/
  components/         App, JobPanel (capture + tailor), BlockEditor, KeywordPanel, RewritePanel,
                      PreviewPane, ActionBar, MasterEditor, SettingsPanel, SortableList
  lib/
    schemas.ts        Zod data model          selection.ts  apply/resolve/reconcile selections
    storage.ts        chrome.storage + Zod    store.ts      Zustand + cross-page sync
    budget.ts, fit.ts page length             keywords.ts   alias/stem matching, gaps
    llm/              client, prompts, idRepair, rewriteGuard, pipeline
    adapters/         types, dom helpers, capture, generic, sites (Lever/Greenhouse/Ashby/Workday)
    pdf/              pdfmake wrapper, resume layout, pdf.js setup + text extraction
    pageBridge.ts     panel → frames: inject, probe, attach, capture
fixtures/             saved ATS pages + recorded LLM responses
test-pages/           local attach test page
tests/                Vitest
scripts/              Playwright e2e, test server, icon generator
```
