# nano-distill

Local document distillation with Gemini Nano — recursive summarization for long-form content.

`nano-distill` is a browser-local PDF summarizer for Chrome Built-in AI. It extracts PDF text with a vendored copy of PDF.js, summarizes long documents in recursive layers with the Summarizer API, and produces a final compact summary with the Prompt API.

## v0.2 highlights

- Static HTML/CSS/JavaScript app; no backend is required.
- PDF text extraction uses the repository-bundled PDF.js 5.7.284 instead of a runtime CDN dependency.
- Initial document chunks are summarized sequentially with Gemini Nano.
- Recursive consolidation uses a maximum fan-in of 5 summaries per group.
- Finalization starts only when both conditions are satisfied:
  - the number of source summaries is 8 or fewer; and
  - the Prompt API context check says the input fits safely.
- Final length is measured deterministically in JavaScript.
- Overlong Final output is re-compressed by a relative ratio instead of asking Gemini Nano to count Japanese characters precisely.
- Intermediate and final generated texts can be exported as a diagnostic JSON log.
- Diagnostic logs are not auto-persisted.
- Recursive prompts ask Gemini Nano to retain at least one major point from each source summary where possible, reducing bias toward only the first or most salient child summary.
- Final prompts distinguish issues, causes, actions, results, and proposals so a problem statement is not silently converted into a recommendation.
- Final output uses concise Japanese plain style (`だ・である` style) as a default, while factual fidelity takes priority over style.

## Privacy and local processing

PDF bytes, extracted text, chunks, intermediate summaries, final summaries, and diagnostic state stay in the browser during processing. The app does not provide an application backend or cloud-LLM fallback.

Diagnostic logs remain in memory unless the user explicitly chooses **診断ログJSONを保存**. The exported JSON contains document-derived intermediate summaries and should therefore be handled as document content.

The **ローカルデータを消去** action clears browser-accessible site data such as Local Storage, Session Storage, IndexedDB, Cache Storage, and Service Worker registrations. The Gemini Nano model itself is managed by Chrome and is outside the site's deletion scope.

See [`docs/privacy.md`](docs/privacy.md) for details.

## Processing flow

```text
PDF
 ↓
PDF.js text extraction
 ↓
page-aware text chunks
 ↓
Level 1 summaries
 ↓
groups of up to 5 summaries
 ↓
recursive consolidation as needed
 ↓
Final input of up to 8 summaries
 ↓
Prompt API final summary
 ↓
JavaScript length check
 ↓
relative re-compression only when needed
```

A large document can therefore look like:

```text
195 pages / 176,077 characters
 → 35 Level-1 summaries
 → 7 consolidated summaries
 → Final summary
```

The 195-page validation case completed with 43 AI calls, no retries, and no timeouts. The diagnostic log was then used to identify two quality issues—coverage loss during recursive consolidation and a Final-stage conversion of a problem statement into an unsupported recommendation—which are addressed by the `recursive-v3` and `final-v3` prompt constraints.

## Diagnostic log

The standard diagnostic log records enough information to trace where document information may have been lost or transformed:

- document metadata
- initial chunk IDs and page ranges
- each intermediate generated summary
- parent/source IDs for recursive summaries
- measured input usage and quota where available
- attempt number, duration, timeout/error state
- Final generation and relative-compression passes
- final character count and run totals

The standard log intentionally does **not** duplicate the complete original source text for every Level-1 chunk.

## Development checks

```bash
npm run verify
```

This runs JavaScript syntax checks and 9 Node-based core tests. GitHub Actions also verifies that the vendored PDF.js module, worker, and license files are present.

## Current scope

Supported in v0.2:

- one text-based PDF at a time
- mostly Japanese business, technical, research, and administrative documents
- local browser summarization with Chrome Built-in AI
- recursive summarization
- diagnostic JSON export

Not yet included:

- OCR for scanned PDFs
- Word / PowerPoint / Excel input
- batch processing
- tags or structured project fields
- database integration
- RAG or document search

## Documents

- [`docs/design_v0.1.md`](docs/design_v0.1.md)
- [`docs/design_v0.2.md`](docs/design_v0.2.md)
- [`docs/design_v0.2_diagnostic_logging.md`](docs/design_v0.2_diagnostic_logging.md)
- [`docs/privacy.md`](docs/privacy.md)
