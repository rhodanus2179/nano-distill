# nano-distill

Local document distillation with Gemini Nano — recursive summarization for long-form content.

`nano-distill` is a static browser application that extracts text from a PDF and recursively summarizes it with Chrome Built-in AI. v0.2.0 limits the amount of material consolidated in a single model call and keeps a local diagnostic trace of intermediate generations.

## v0.2.0 highlights

- Drag & drop a single text PDF
- Extract page text locally with PDF.js
- PDF.js is vendored with the application; no runtime CDN fetch
- Split source text into quota-safe chunks
- Summarize chunks sequentially with Chrome Summarizer API
- Limit recursive fan-in to at most 5 summaries per call
- Send at most 8 top-level summaries to the final Prompt API call
- Measure final Japanese character count in JavaScript
- If the final summary is over 550 characters, ask Nano to compress it by a calculated relative ratio, up to two passes
- Never truncate the final text mechanically
- Record intermediate summaries, parent IDs, attempts, durations, failures and final compression passes in an in-memory diagnostic log
- Export the diagnostic log to JSON only when the user explicitly requests it
- Cancel an in-progress run and still export the partial diagnostic log
- Clear site-controlled browser storage from the UI

## Privacy model

Document content is handled locally by the application.

- Selected PDF bytes, extracted text, intermediate summaries and the final summary are not uploaded by the application.
- Diagnostic logs are held in memory and are not persisted automatically.
- The diagnostic JSON may contain document-derived content; saving it is an explicit user action.
- PDF.js is distributed locally with the app rather than fetched from a CDN at runtime.
- Chrome manages the Gemini Nano model separately from site storage.

See [`docs/privacy.md`](docs/privacy.md) for the exact boundary.

## Requirements

- Desktop Chrome with Summarizer API and Prompt API available
- A device satisfying Chrome Built-in AI requirements
- A PDF containing a usable text layer

OCR is not included in v0.2.0.

## Run locally

Serve the repository with any static HTTP server. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/` in Chrome.

Opening `index.html` directly with `file://` is not supported.

## Architecture

```text
PDF
 ↓
local PDF.js text extraction
 ↓
quota-safe source chunks
 ↓
Summarizer API
 ↓
Level 1 summaries
 ↓
fan-in <= 5 recursive consolidation
 ↓
<= 8 top summaries + Prompt API context check
 ↓
final synthesis
 ↓
JS character measurement
 ↓
relative compression only when > 550 chars
```

## Diagnostic log

The exported JSON records full intermediate summary output, but standard logging does not duplicate the full original Level 1 source chunks. Parent IDs and page ranges allow the summarization tree to be reconstructed while reducing duplicated sensitive content.

Design documents:

- [`docs/design_v0.2.md`](docs/design_v0.2.md)
- [`docs/design_v0.2_diagnostic_logging.md`](docs/design_v0.2_diagnostic_logging.md)
