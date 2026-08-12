const SENTENCE_END = /(?<=[。！？!?])/u;

export function normalizeText(text) {
  return String(text ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ \u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitLongSegment(text, maxChars) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
  const pieces = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(SENTENCE_END).filter(Boolean);
    if (sentences.length > 1) {
      let buffer = '';
      for (const sentence of sentences) {
        if (sentence.length > maxChars) {
          if (buffer) {
            pieces.push(buffer.trim());
            buffer = '';
          }
          pieces.push(...hardSplit(sentence, maxChars));
        } else if (!buffer || buffer.length + sentence.length <= maxChars) {
          buffer += sentence;
        } else {
          pieces.push(buffer.trim());
          buffer = sentence;
        }
      }
      if (buffer) pieces.push(buffer.trim());
      continue;
    }

    pieces.push(...hardSplit(paragraph, maxChars));
  }

  return pieces.filter(Boolean);
}

export function createDocumentChunks(pages, maxChars, overlapChars = 0) {
  const atoms = [];
  for (const page of pages) {
    const pieces = splitLongSegment(page.text, maxChars);
    for (const piece of pieces) {
      atoms.push({
        text: piece,
        pageStart: page.pageNumber,
        pageEnd: page.pageNumber,
      });
    }
  }

  const chunks = [];
  let buffer = null;

  const pushBuffer = () => {
    if (!buffer?.text?.trim()) return;
    chunks.push({
      id: `C${String(chunks.length + 1).padStart(3, '0')}`,
      order: chunks.length + 1,
      text: buffer.text.trim(),
      pageStart: buffer.pageStart,
      pageEnd: buffer.pageEnd,
    });
  };

  for (const atom of atoms) {
    if (!buffer) {
      buffer = { ...atom };
      continue;
    }
    const candidate = `${buffer.text}\n\n${atom.text}`;
    if (candidate.length <= maxChars) {
      buffer.text = candidate;
      buffer.pageEnd = atom.pageEnd;
      continue;
    }

    pushBuffer();
    const overlap = overlapChars > 0 ? tailAtNaturalBoundary(buffer.text, overlapChars) : '';
    buffer = {
      text: overlap ? `${overlap}\n\n${atom.text}` : atom.text,
      pageStart: overlap ? buffer.pageEnd : atom.pageStart,
      pageEnd: atom.pageEnd,
    };

    if (buffer.text.length > maxChars) {
      const reSplit = splitLongSegment(buffer.text, maxChars);
      for (const piece of reSplit.slice(0, -1)) {
        chunks.push({
          id: `C${String(chunks.length + 1).padStart(3, '0')}`,
          order: chunks.length + 1,
          text: piece,
          pageStart: buffer.pageStart,
          pageEnd: buffer.pageEnd,
        });
      }
      buffer.text = reSplit.at(-1) ?? '';
    }
  }

  pushBuffer();
  return chunks;
}

export function packSegments(segments, maxChars, overlapChars = 0) {
  const atoms = segments.flatMap((segment) => splitLongSegment(segment, maxChars));
  const chunks = [];
  let buffer = '';

  for (const atom of atoms) {
    const separator = buffer ? '\n\n' : '';
    if (!buffer || buffer.length + separator.length + atom.length <= maxChars) {
      buffer += `${separator}${atom}`;
      continue;
    }

    chunks.push(buffer.trim());
    const overlap = overlapChars > 0 ? tailAtNaturalBoundary(buffer, overlapChars) : '';
    buffer = overlap ? `${overlap}\n\n${atom}` : atom;

    if (buffer.length > maxChars) {
      const reSplit = splitLongSegment(buffer, maxChars);
      chunks.push(...reSplit.slice(0, -1));
      buffer = reSplit.at(-1) ?? '';
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

function hardSplit(text, maxChars) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    chunks.push(text.slice(offset, offset + maxChars).trim());
  }
  return chunks.filter(Boolean);
}

function tailAtNaturalBoundary(text, maxChars) {
  if (text.length <= maxChars) return text.trim();
  const tail = text.slice(-maxChars);
  const sentence = tail.indexOf('。');
  const newline = tail.indexOf('\n');
  const candidates = [sentence, newline].filter((value) => value >= 0);
  const boundary = candidates.length ? Math.min(...candidates) : -1;
  if (boundary >= 0 && boundary < tail.length - 1) return tail.slice(boundary + 1).trim();
  return tail.trim();
}

export function countChars(text) {
  return Array.from(String(text ?? '')).length;
}

export function countSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  const matches = normalized.match(/[^。！？!?]+(?:[。！？!?]+|$)/gu) ?? [];
  return matches.filter((part) => part.trim()).length;
}

export function countParagraphs(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return normalized.split(/\n{2,}/).filter((part) => part.trim()).length;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}
