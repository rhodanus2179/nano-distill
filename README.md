# nano-distill

Local document distillation with Gemini Nano — recursive summarization for long-form content.

`nano-distill` is a static browser application that extracts text from a PDF and recursively summarizes it with Chrome Built-in AI until it can produce a final Japanese summary of roughly 350–450 characters.

## v0.1 scope

- Drag & drop a single text PDF
- Extract page text with PDF.js
- Split the extracted text into quota-safe chunks
- Summarize chunks sequentially with the Summarizer API
- Recursively summarize summaries when the combined text is still too large
- Produce the final ~400-character Japanese summary with the Prompt API
- Show progress, elapsed time, retry state, and summary hierarchy
- Cancel an in-progress run
- Copy the final summary
- Clear site-controlled browser storage from the UI

## Privacy model

Document content is handled locally.

- The selected PDF is read with the browser File API.
- PDF bytes, extracted text, intermediate summaries, and the final summary are **not uploaded by the application**.
- Document data is held in memory for the active page session and is discarded when the document is reset, site data is cleared, or the page is closed.
- The **Clear local data** action clears storage that this origin can control: Local Storage, Session Storage, IndexedDB, Cache Storage, and service-worker registrations.
- Chrome manages the Gemini Nano model separately. The app cannot and does not delete the browser-managed model.
- PDF.js code is loaded from a pinned jsDelivr URL in v0.1. The PDF itself is passed to PDF.js as a local `ArrayBuffer`; the app contains no code that sends the PDF or extracted content to the CDN.

Chrome documents that after the built-in model is downloaded, subsequent on-device use does not require a network connection and model input is not sent to Google or third parties.

## Requirements

- Desktop Chrome with the Summarizer API and Prompt API available
- A device that satisfies Chrome Built-in AI hardware/storage requirements
- A PDF containing a usable text layer

OCR is not included in v0.1.

## Run locally

Serve the repository with any static HTTP server. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/` in Chrome.

Opening `index.html` directly with `file://` is not supported because module loading, PDF.js workers, and Built-in AI are designed for secure web origins / localhost.

## Architecture

```text
PDF
 ↓
PDF.js text extraction
 ↓
normalization / natural-boundary chunking
 ↓
Summarizer API (Gemini Nano)
 ↓
summary groups
 ↓
recursive Summarizer API passes
 ↓
Prompt API final synthesis
 ↓
350–450 character Japanese summary
```

The recursion depth is dynamic. A 200-page PDF can add as many intermediate levels as needed, subject to a safety cap.

## Design

See [`docs/design_v0.1.md`](docs/design_v0.1.md).
