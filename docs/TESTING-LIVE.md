# Testing attach on live ATS pages

The automated e2e run (`npm run build:e2e && npm run e2e`) covers the local test page only:
a plain input, a hidden input behind a button, a drop zone with no input, and an input inside an iframe.
Live ATS pages change their DOM often, so check them by hand before relying on a site.

**The extension never submits an application.** Attaching only fills the upload field. Still,
use postings you don't mind touching, and never click Submit while testing.

## General procedure

1. `npm run build`, then load `.output/chrome-mv3` unpacked (see README).
2. Open a real posting's **application form** in a tab.
3. Open the side panel (toolbar icon). In **Settings → Diagnostics**, click
   **Attach test PDF to current page** (on a non-ATS site, Chrome first asks for access to that site).
4. Expected: the form shows `attach-test.pdf` as the attached resume.
5. If it fails, open DevTools on the page, select the frame that holds the form in the console's
   context dropdown, and look for `[resume-tailor]` messages. Record the upload field's markup
   (right-click → Inspect) so the adapter selectors can be updated.

## Per-site notes

| Site | Where the upload lives | What to check |
|------|------------------------|---------------|
| **Lever** (`jobs.lever.co/<company>/<id>/apply`) | Plain `input[name="resume"]` | After attaching, Lever starts parsing the resume and may autofill the name and email fields. That is Lever's own behavior. |
| **Greenhouse** (`boards.greenhouse.io/...`, `job-boards.greenhouse.io/...`) | New boards: `input#resume` (hidden) behind an "Attach" button. Old boards: a hidden S3 upload form. | Also test a company careers page that **embeds** Greenhouse (`iframe#grnhse_iframe`). The content script runs inside the iframe because `*.greenhouse.io` is a host permission, so attaching works without access to the company's domain. JD capture there comes from the iframe. |
| **Ashby** (`jobs.ashbyhq.com/<company>/<id>/application`) | React upload zone with a hidden `input[type=file]` (resume system field) | The file name should appear in the upload zone. If only the drop path fires, check that Ashby accepted it (the name shows under "Resume"). |
| **Workday** (`<tenant>.myworkdayjobs.com/...`) | Multi-step flow. Upload is on "My Experience" / "Quick apply": `[data-automation-id="file-upload-input-ref"]` or the drop zone `[data-automation-id="file-upload-drop-zone"]`. | Workday requires signing in. Go to the step with the resume upload, **then** click attach. If you click earlier, the adapter waits up to 8 s for the step to render (MutationObserver) and then reports that it found no target. |

## What "verified" means

- `input` method: the adapter read `input.files` back after setting it. That proves the page holds the
  file, not that the site's framework processed it. Look at the page UI to confirm.
- `dropzone` method: synthetic `dragenter/dragover/drop` events were dispatched. There is no input to
  read back, so always confirm visually.

If neither works on a site, use the fallbacks in the panel: **Drag file** (drag the chip onto the
page's upload zone), **Copy text**, or **Download**.
