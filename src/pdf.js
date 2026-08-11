import { PDFJS_MODULE_URL, PDFJS_WORKER_URL } from './config.js';
import { normalizeText } from './text.js';

let pdfjsPromise;

async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_MODULE_URL).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
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
    let emptyPageCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal?.throwIfAborted?.();
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = normalizeText(textItemsToText(textContent.items));
      if (!text) emptyPageCount += 1;
      pages.push({ pageNumber, text });
      page.cleanup?.();
      onProgress?.({ pageNumber, pageCount: pdf.numPages });
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      pageCount: pdf.numPages,
      emptyPageCount,
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
  const leftLast = left.at(-1);
  const rightFirst = right[0];
  const asciiWord = /[A-Za-z0-9]/;
  return asciiWord.test(leftLast) && asciiWord.test(rightFirst);
}

function assertPdfFile(file) {
  if (!(file instanceof File)) throw new TypeError('PDFファイルを選択してください。');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new TypeError('PDF形式のファイルのみ読み込めます。');
}
