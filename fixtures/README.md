# Fixtures

Saved job-page HTML used by the unit tests (`tests/adapters.test.ts`, jsdom) and by the browser
e2e (`scripts/e2e-attach.mjs`). The e2e serves each file at its real ATS URL through Playwright
request routing, so the statically registered content script runs exactly as it would on the live site.

These are **synthetic**. They copy each ATS's DOM structure (class names, ids, `data-automation-id`
hooks) as observed on public postings, but the companies and job text are made up. Live markup
changes over time. When an adapter breaks on a real site, save that page here (strip personal data)
and add a test case.

| File | Modeled on | Exercises |
|------|-----------|-----------|
| `lever.html` | jobs.lever.co posting + apply form | site selectors (no JSON-LD), `input[name=resume]` |
| `greenhouse.html` | job-boards.greenhouse.io | `.job__description`, hidden `#resume` behind an Attach button, cover-letter input that must *not* be chosen |
| `ashby.html` | jobs.ashbyhq.com application | JSON-LD wins over site selectors, React-style upload zone with a hidden input |
| `workday.html` | *.myworkdayjobs.com | `data-automation-id` selectors, upload step that renders 1.5 s later (MutationObserver wait) |
| `generic-jsonld.html` | company careers page | JSON-LD inside `@graph`, a broken JSON-LD block that is skipped, generic CV input |
| `analysis/*.json` | LLM responses | recorded analyze/select outputs for the mocked-API pipeline tests |
