# Privacy and local-data handling

## Principle

`nano-distill` is designed so that document information is processed locally in the browser.

## Document data

The following data is not intentionally persisted by v0.2.0:

- selected PDF bytes
- extracted page text
- source chunk text
- intermediate summaries
- final summary
- diagnostic run log

The application contains no document upload endpoint and no cloud-LLM fallback.

## PDF.js

PDF.js is vendored in `vendor/pdfjs/` and loaded from the same origin as the application. v0.2.0 therefore does not require a runtime CDN request to parse a PDF.

The vendored PDF.js files retain Mozilla's Apache-2.0 licensing information.

## Built-in AI

Summarization uses Chrome Built-in AI. Gemini Nano / browser-managed models are controlled by Chrome, not by this application. The application cannot remove the model through site-storage APIs.

## Diagnostic logs

A diagnostic log is created in JavaScript memory while summarization runs. It can contain document-derived text, including full intermediate summaries and final-generation passes.

The application does not automatically write this log to Local Storage, Session Storage or IndexedDB. A JSON file is created only when the user explicitly selects **診断ログJSONを保存**.

Standard diagnostic logging does not duplicate the full Level 1 original source text. It records source chunk IDs, page ranges and input statistics instead.

A partial log remains exportable after an error or cancellation until the document is reset, local data is cleared, or the page is closed.

## Clear local data

The UI clear-data action:

1. cancels active extraction/summarization;
2. drops references to the current PDF, summaries and diagnostic log;
3. clears Local Storage;
4. clears Session Storage;
5. deletes accessible IndexedDB databases for the origin;
6. deletes Cache Storage entries for the origin;
7. unregisters service workers for the origin.

This action does **not** clear:

- Chrome's browser-managed Gemini Nano model;
- the browser's general HTTP cache;
- files the user explicitly saved, including exported diagnostic JSON files;
- operating-system temporary files outside the web origin's control.
