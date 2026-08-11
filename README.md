# nano-distill

Local document distillation with Gemini Nano — recursive summarization for long-form content.

## Overview

`nano-distill` is a browser-based local document summarizer for long PDF files.

The first release targets a simple workflow:

1. Drag and drop a text-based PDF.
2. Extract text locally with PDF.js.
3. Split the extracted text into safe chunks.
4. Summarize each chunk with Chrome Built-in AI.
5. Recursively summarize the summaries until the content fits into a final synthesis pass.
6. Generate an approximately 400-character Japanese summary.

The PDF text and summarization inputs are intended to stay on the user's device. No application backend or cloud LLM API is required for the initial release.

## Initial scope

- Desktop Chrome
- Text-based PDF files
- PDF.js text extraction
- Chrome Summarizer API / Gemini Nano for recursive summarization
- Chrome Prompt API / Gemini Nano for the final 350–450 Japanese-character summary
- Progress, cancellation, retry, and error display
- Static web application

Not included in the first release: OCR, tags, database integration, batch PDF processing, Word/PowerPoint input, RAG, or cloud fallback.

## Design

See [`docs/design_v0.1.md`](docs/design_v0.1.md).

## Status

Design phase.
