# Privacy and local-data handling

## Principle

`nano-distill` is designed so that document information is processed locally in the browser.

### Document data kept in memory

The following data is not intentionally persisted by v0.1:

- selected PDF bytes
- extracted page text
- chunk text
- intermediate summaries
- final summary

The application does not contain an upload endpoint or a cloud-LLM fallback.

### Built-in AI

Summarization uses Chrome Built-in AI. Gemini Nano / browser-managed models are controlled by Chrome, not by this application. The application cannot remove the model through site-storage APIs.

### PDF.js runtime dependency

v0.1 loads a pinned PDF.js build from jsDelivr. This fetches program code, not the selected document. The PDF file is read locally with `File.arrayBuffer()` and provided to PDF.js as in-memory data.

A future release may vendor PDF.js in the repository to remove this runtime network dependency entirely.

## Clear local data

The UI provides a clear-data action. It:

1. cancels any active summarization;
2. drops references to the current document in application state;
3. clears Local Storage;
4. clears Session Storage;
5. deletes accessible IndexedDB databases for the origin;
6. deletes Cache Storage entries for the origin;
7. unregisters service workers for the origin.

This action does **not** clear:

- Chrome's browser-managed Gemini Nano model;
- the browser's general HTTP cache;
- operating-system temporary files outside the web origin's control.

v0.1 does not intentionally store document data in any of the cleared persistent stores; the button is included for user control and future-proofing.
