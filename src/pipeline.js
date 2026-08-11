import {
  canFitFinalPrompt,
  createFinalSession,
  createIntermediateSummarizer,
  generateFinalSummary,
  getSummarizerSafeQuota,
  measureSummarizerUsage,
  summarizeUnit,
} from './ai.js';
import { PIPELINE_CONFIG } from './config.js';
import { normalizeText, packSegments, splitLongSegment } from './text.js';

export class RecursiveSummaryPipeline {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.controller = null;
    this.summarizer = null;
    this.finalSession = null;
  }

  cancel() {
    this.controller?.abort();
    this.summarizer?.destroy?.();
    this.finalSession?.destroy?.();
    this.controller = null;
    this.finalSession = null;
    this.summarizer = null;
  }

  dispose() {
    this.cancel();
  }

  async run(documentData) {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const startedAt = performance.now();
    const levels = [];
    let totalAiCalls = 0;

    this.callbacks.onStage?.({ stage: 'model', title: 'Gemini Nanoを準備中' });

    // Start both create() calls before the first await. Chrome may require
    // transient user activation when a built-in model must be downloaded.
    const summarizerPromise = createIntermediateSummarizer({
      onDownloadProgress: (loaded) => this.callbacks.onModelDownload?.(loaded),
    });
    const finalSessionPromise = createFinalSession({
      signal,
      onDownloadProgress: (loaded) => this.callbacks.onModelDownload?.(loaded),
    });

    [this.summarizer, this.finalSession] = await Promise.all([
      summarizerPromise,
      finalSessionPromise,
    ]);

    signal.throwIfAborted?.();
    this.callbacks.onStage?.({ stage: 'chunk', title: '文書を分割中' });

    const pageTexts = documentData.pages.map((page) => page.text).filter(Boolean);
    let chunks = packSegments(pageTexts, PIPELINE_CONFIG.initialChunkChars, PIPELINE_CONFIG.chunkOverlapChars);
    chunks = await ensureQuotaSafeChunks(chunks, this.summarizer, signal);
    if (!chunks.length) throw new Error('要約できるテキストがありません。');

    const firstLevel = await this.#summarizeLevel(chunks, 1, signal, '原文チャンク');
    totalAiCalls += firstLevel.length;
    levels.push({ level: 1, inputCount: chunks.length, outputCount: firstLevel.length });
    this.callbacks.onLevelComplete?.(levels.at(-1));

    let current = firstLevel;
    let level = 2;

    while (!(await canFitFinalPrompt(this.finalSession, current.join('\n\n')))) {
      if (level > PIPELINE_CONFIG.maxRecursionLevels) {
        throw new Error('要約階層が上限に達しました。文書を小さく分けて再実行してください。');
      }

      const groups = await groupSummariesForQuota(current, this.summarizer, signal);
      if (groups.length >= current.length && current.length > 1) {
        current = pairSummaries(current);
      } else {
        current = groups;
      }

      const summarized = await this.#summarizeLevel(current, level, signal, `第${level - 1}層の要約`);
      totalAiCalls += summarized.length;
      levels.push({ level, inputCount: current.length, outputCount: summarized.length });
      this.callbacks.onLevelComplete?.(levels.at(-1));
      current = summarized;
      level += 1;
    }

    signal.throwIfAborted?.();
    this.callbacks.onStage?.({ stage: 'final', title: '最終要約を生成中' });

    const finalSummary = await generateFinalSummary(this.finalSession, current.join('\n\n'), {
      signal,
      onAttempt: (info) => this.callbacks.onAttempt?.({ ...info, phase: 'final' }),
    });
    totalAiCalls += 1;

    const elapsedMs = performance.now() - startedAt;
    return {
      finalSummary,
      levels,
      initialChunkCount: chunks.length,
      totalAiCalls,
      elapsedMs,
    };
  }

  async #summarizeLevel(inputs, level, signal, sourceLabel) {
    const outputs = [];
    const total = inputs.length;

    this.callbacks.onStage?.({
      stage: 'summarize',
      title: level === 1 ? '第1層を要約中' : `第${level}層を統合中`,
    });

    for (let index = 0; index < inputs.length; index += 1) {
      signal.throwIfAborted?.();
      this.callbacks.onProgress?.({ level, index, total, fraction: index / Math.max(total, 1) });

      const summary = await summarizeUnit(this.summarizer, inputs[index], {
        signal,
        context: `${sourceLabel}の${index + 1}/${total}です。前後の要約と後で統合されます。局所情報を落としすぎないでください。`,
        onAttempt: (info) => this.callbacks.onAttempt?.({ ...info, phase: 'intermediate', level, index, total }),
      });
      outputs.push(normalizeText(summary));
    }

    this.callbacks.onProgress?.({ level, index: total, total, fraction: 1 });
    return outputs;
  }
}

async function ensureQuotaSafeChunks(chunks, summarizer, signal) {
  const safeQuota = getSummarizerSafeQuota(summarizer);
  if (!safeQuota) return chunks;

  const output = [];
  for (const chunk of chunks) {
    signal.throwIfAborted?.();
    await splitUntilSafe(chunk, summarizer, safeQuota, output, signal);
  }
  return output;
}

async function splitUntilSafe(text, summarizer, safeQuota, output, signal, depth = 0) {
  signal.throwIfAborted?.();
  const usage = await measureSummarizerUsage(summarizer, text);
  if (usage === null || usage <= safeQuota) {
    output.push(text);
    return;
  }

  if (depth > 8 || text.length < 500) {
    throw new Error('Gemini Nanoの入力上限に収まるようテキストを分割できませんでした。');
  }

  const targetChars = Math.max(500, Math.floor(text.length * (safeQuota / usage) * 0.82));
  const pieces = splitLongSegment(text, targetChars);
  if (pieces.length <= 1) {
    const midpoint = Math.ceil(text.length / 2);
    pieces.splice(0, pieces.length, text.slice(0, midpoint), text.slice(midpoint));
  }

  for (const piece of pieces) {
    await splitUntilSafe(piece, summarizer, safeQuota, output, signal, depth + 1);
  }
}

async function groupSummariesForQuota(summaries, summarizer, signal) {
  const safeQuota = getSummarizerSafeQuota(summarizer);
  if (!safeQuota) return packByChars(summaries, PIPELINE_CONFIG.initialChunkChars);

  const groups = [];
  let current = '';

  for (const summary of summaries) {
    signal.throwIfAborted?.();
    const candidate = current ? `${current}\n\n${summary}` : summary;
    const usage = await measureSummarizerUsage(summarizer, candidate);

    if (usage === null) return packByChars(summaries, PIPELINE_CONFIG.initialChunkChars);

    if (!current || usage <= safeQuota) {
      current = candidate;
      continue;
    }

    groups.push(current);
    current = summary;
  }

  if (current) groups.push(current);
  return groups;
}

function packByChars(summaries, maxChars) {
  return packSegments(summaries, maxChars, 0);
}

function pairSummaries(summaries) {
  const pairs = [];
  for (let index = 0; index < summaries.length; index += 2) {
    pairs.push(summaries.slice(index, index + 2).join('\n\n'));
  }
  return pairs;
}
