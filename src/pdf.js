import { PDFJS_MODULE_URL, PDFJS_WORKER_URL } from './config.js';
import { normalizeText } from './text.js';

let pdfjsPromise;

async function getPdfJs() {
  if (!pdfjsPromise) {
    const moduleUrl = new URL(PDFJS_MODULE_URL, import.meta.url).href;
    const workerUrl = new URL(PDFJS_WORKER_URL, import.meta.url).href;
    pdfjsPromise = import(moduleUrl).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}

export async function extractPdfText(file, { signal, onProgress } = {}) {
  assertPdfFile(file);
  signal?.throwIfAborted?.();

  const pdfjsLib = await getPdfJs();
  signal?.throwIfAborted?.();

  const data = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted?.();

  const loadingTask = pdfjsLib.getDocument({ data });
  let pdf;

  try {
    pdf = await loadingTask.promise;
    const pages = [];
    const emptyPageNumbers = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal?.throwIfAborted?.();
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = normalizeText(textItemsToText(textContent.items));
      if (!text) emptyPageNumbers.push(pageNumber);
      pages.push({ pageNumber, text });
      page.cleanup?.();
      onProgress?.({ pageNumber, pageCount: pdf.numPages });
      if (pageNumber % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      pageCount: pdf.numPages,
      emptyPageCount: emptyPageNumbers.length,
      emptyPageNumbers,
      extractedPageCount: pdf.numPages - emptyPageNumbers.length,
      pages,
      charCount: pages.reduce((sum, page) => sum + page.text.length, 0),
    };
  } finally {
    if (pdf) await pdf.destroy?.();
    else await loadingTask.destroy?.();
  }
}

function textItemsToText(items) {
  let output = '';
  let previousItem = null;

  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const current = item.str;
    if (!current) {
      if (item.hasEOL) output += '\n';
      continue;
    }

    if (previousItem && !output.endsWith('\n') && shouldInsertSpace(previousItem.str, current)) {
      output += ' ';
    }

    output += current;
    if (item.hasEOL) output += '\n';
    previousItem = item;
  }

  return output;
}

function shouldInsertSpace(left, right) {
  if (!left || !right) return false;
  const asciiWord = /[A-Za-z0-9]/;
  return asciiWord.test(left.at(-1)) && asciiWord.test(right[0]);
}

function assertPdfFile(file) {
  if (!(file instanceof File)) throw new TypeError('PDFファイルを選択してください。');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new TypeError('PDF形式のファイルのみ読み込めます。');
}
