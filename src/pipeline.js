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
import {
  beginFinalization,
  createAiCall,
  createLevel,
  createRunLog,
  downloadRunLog,
  finishAiCall,
  finishFinalization,
  finishLevel,
  finishRun,
  recordAttempt,
  recordFinalPass,
  recordInitialChunks,
  recordPassthrough,
} from './diagnostics.js';
import { countChars, createDocumentChunks, normalizeText, splitLongSegment } from './text.js';

export class RecursiveSummaryPipeline {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.controller = null;
    this.summarizer = null;
    this.finalSession = null;
    this.runLog = null;
  }

  abort() {
    this.controller?.abort();
    this.summarizer?.destroy?.();
    this.finalSession?.destroy?.();
  }

  reset() {
    this.abort();
    this.controller = null;
    this.summarizer = null;
    this.finalSession = null;
    this.runLog = null;
    this.callbacks.onLogAvailability?.(false);
  }

  getRunLog() {
    return this.runLog;
  }

  saveDiagnosticLog() {
    if (!this.runLog) throw new Error('保存できる診断ログがありません。');
    downloadRunLog(this.runLog);
  }

  async run(documentData, { extractionWarning = '' } = {}) {
    this.reset();
    this.controller = new AbortController();
    const { signal } = this.controller;
    const startedAt = performance.now();
    const runLog = createRunLog(documentData, extractionWarning);
    this.runLog = runLog;
    this.callbacks.onLogAvailability?.(true);

    let totalAiCalls = 0;
    const levels = [];

    try {
      this.callbacks.onStage?.({ stage: 'model', title: 'Gemini Nanoを準備中' });

      // Start both create() calls before the first await so model download can
      // inherit the user's activation from the Start button click.
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

      let chunks = createDocumentChunks(
        documentData.pages.filter((page) => page.text),
        PIPELINE_CONFIG.initialChunkChars,
        PIPELINE_CONFIG.chunkOverlapChars,
      );
      chunks = await ensureQuotaSafeDocumentChunks(chunks, this.summarizer, signal);
      if (!chunks.length) throw new Error('要約できるテキストがありません。');
      recordInitialChunks(runLog, chunks);

      const first = await this.#summarizeDocumentChunks(chunks, signal, runLog);
      totalAiCalls += first.aiCallCount;
      levels.push(first.summary);
      this.callbacks.onLevelComplete?.(first.summary);

      let current = first.nodes;
      let level = 2;

      while (!(await canFinalize(this.finalSession, current))) {
        if (level > PIPELINE_CONFIG.maxRecursionLevels) {
          throw new Error('要約階層が上限に達しました。文書を小さく分けて再実行してください。');
        }

        const grouped = await groupSummaryNodesForQuota(current, this.summarizer, signal);
        const next = await this.#summarizeGroups(grouped, level, signal, runLog);
        totalAiCalls += next.aiCallCount;
        levels.push(next.summary);
        this.callbacks.onLevelComplete?.(next.summary);
        current = next.nodes;
        level += 1;
      }

      signal.throwIfAborted?.();
      this.callbacks.onStage?.({ stage: 'final', title: '最終要約を生成中' });
      beginFinalization(runLog, current);

      const finalResult = await generateFinalSummary(this.finalSession, current.map((node) => node.text).join('\n\n'), {
        signal,
        onPass: (info) => {
          this.callbacks.onFinalPass?.(info);
          if (info.state !== 'start') recordFinalPass(runLog, info);
        },
      });
      totalAiCalls = runLog.totals.aiCallsStarted;
      finishFinalization(runLog, { finalText: finalResult.text, lengthStatus: finalResult.lengthStatus });
      finishRun(runLog, { status: 'done', startedAtMs: startedAt });

      const elapsedMs = performance.now() - startedAt;
      return {
        finalSummary: finalResult.text,
        finalLengthStatus: finalResult.lengthStatus,
        finalLengthHistory: finalResult.passes.map((pass) => ({
          pass: pass.pass,
          characters: pass.outputCharacters,
          requestedRatio: pass.requestedRatio,
          status: pass.status,
        })),
        finalSourceCount: current.length,
        finalSourceCharacters: current.reduce((sum, node) => sum + countChars(node.text), 0),
        levels,
        initialChunkCount: chunks.length,
        totalAiCalls,
        elapsedMs,
      };
    } catch (error) {
      const status = signal.aborted || error?.name === 'AbortError' ? 'cancelled' : 'error';
      finishRun(runLog, { status, startedAtMs: startedAt, error });
      throw error;
    } finally {
      this.summarizer?.destroy?.();
      this.finalSession?.destroy?.();
      this.summarizer = null;
      this.finalSession = null;
      this.controller = null;
    }
  }

  async #summarizeDocumentChunks(chunks, signal, runLog) {
    const level = 1;
    const levelRecord = createLevel(runLog, { level, inputCount: chunks.length, groupCount: chunks.length });
    const nodes = [];

    this.callbacks.onStage?.({ stage: 'summarize', title: '第1層を要約中' });
    for (let index = 0; index < chunks.length; index += 1) {
      signal.throwIfAborted?.();
      this.callbacks.onProgress?.({ level, index, total: chunks.length, fraction: index / chunks.length });
      const chunk = chunks[index];
      const callId = `L1-C${String(index + 1).padStart(3, '0')}`;
      const measuredUsage = await measureSummarizerUsage(this.summarizer, chunk.text);
      const context = `原文チャンクの${index + 1}/${chunks.length}です。前後の要約と後で統合されます。局所情報を落としすぎないでください。`;
      const call = createAiCall(levelRecord, {
        callId,
        phase: 'intermediate',
        level,
        order: index + 1,
        source: {
          type: 'document-chunk',
          sourceIds: [chunk.id],
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
        },
        inputText: chunk.text,
        measuredUsage,
        inputQuota: this.summarizer.inputQuota ?? null,
        context,
      });
      const startedAt = performance.now();

      try {
        const summary = normalizeText(await summarizeUnit(this.summarizer, chunk.text, {
          signal,
          context,
          onAttempt: (info) => {
            recordAttempt(runLog, call, info);
            this.callbacks.onAttempt?.({ ...info, phase: 'intermediate', level, index, total: chunks.length });
          },
        }));
        finishAiCall(runLog, levelRecord, call, {
          outputText: summary,
          durationMs: performance.now() - startedAt,
        });
        nodes.push({
          id: callId,
          level,
          order: index + 1,
          text: summary,
          sourceIds: [chunk.id],
        });
      } catch (error) {
        finishAiCall(runLog, levelRecord, call, {
          outputText: '',
          durationMs: performance.now() - startedAt,
          status: 'failed',
          error,
        });
        throw error;
      }
    }

    this.callbacks.onProgress?.({ level, index: chunks.length, total: chunks.length, fraction: 1 });
    finishLevel(runLog, levelRecord, nodes.length);
    return {
      nodes,
      aiCallCount: nodes.length,
      summary: summarizeLevelRecord(levelRecord),
    };
  }

  async #summarizeGroups(groups, level, signal, runLog) {
    const levelRecord = createLevel(runLog, {
      level,
      inputCount: groups.reduce((sum, group) => sum + group.length, 0),
      groupCount: groups.length,
    });
    const nodes = [];
    let aiCallCount = 0;

    this.callbacks.onStage?.({ stage: 'summarize', title: `第${level}層を統合中` });
    for (let index = 0; index < groups.length; index += 1) {
      signal.throwIfAborted?.();
      this.callbacks.onProgress?.({ level, index, total: groups.length, fraction: index / groups.length });
      const group = groups[index];

      if (group.length === 1 && groups.length > 1) {
        const source = group[0];
        const nodeId = `L${level}-P${String(index + 1).padStart(3, '0')}`;
        recordPassthrough(levelRecord, {
          nodeId,
          level,
          order: index + 1,
          sourceIds: [source.id],
          text: source.text,
        });
        nodes.push({
          id: nodeId,
          level,
          order: index + 1,
          text: source.text,
          sourceIds: [source.id],
        });
        continue;
      }

      const inputText = group.map((node) => node.text).join('\n\n');
      const measuredUsage = await measureSummarizerUsage(this.summarizer, inputText);
      const callId = `L${level}-G${String(index + 1).padStart(3, '0')}`;
      const context = `第${level - 1}層の連続する要約${group.length}件を統合します。各要約にしかない重要情報を不用意に落とさず、重複を整理してください。`;
      const call = createAiCall(levelRecord, {
        callId,
        phase: 'recursive-summary',
        level,
        order: index + 1,
        source: {
          type: 'summary-group',
          sourceIds: group.map((node) => node.id),
        },
        inputText,
        itemCount: group.length,
        measuredUsage,
        inputQuota: this.summarizer.inputQuota ?? null,
        context,
      });
      const startedAt = performance.now();

      try {
        const summary = normalizeText(await summarizeUnit(this.summarizer, inputText, {
          signal,
          context,
          onAttempt: (info) => {
            recordAttempt(runLog, call, info);
            this.callbacks.onAttempt?.({ ...info, phase: 'intermediate', level, index, total: groups.length });
          },
        }));
        finishAiCall(runLog, levelRecord, call, {
          outputText: summary,
          durationMs: performance.now() - startedAt,
        });
        nodes.push({
          id: callId,
          level,
          order: index + 1,
          text: summary,
          sourceIds: group.map((node) => node.id),
        });
        aiCallCount += 1;
      } catch (error) {
        finishAiCall(runLog, levelRecord, call, {
          outputText: '',
          durationMs: performance.now() - startedAt,
          status: 'failed',
          error,
        });
        throw error;
      }
    }

    this.callbacks.onProgress?.({ level, index: groups.length, total: groups.length, fraction: 1 });
    finishLevel(runLog, levelRecord, nodes.length);
    return {
      nodes,
      aiCallCount,
      summary: summarizeLevelRecord(levelRecord),
    };
  }
}

export async function canFinalize(session, nodes) {
  if (nodes.length > PIPELINE_CONFIG.maxFinalSourceItems) return false;
  return canFitFinalPrompt(session, nodes.map((node) => node.text).join('\n\n'));
}

export async function groupSummaryNodesForQuota(nodes, summarizer, signal) {
  const safeQuota = getSummarizerSafeQuota(summarizer);
  const groups = [];
  let current = [];

  for (const node of nodes) {
    signal?.throwIfAborted?.();
    if (!current.length) {
      current = [node];
      continue;
    }

    if (current.length >= PIPELINE_CONFIG.maxSummariesPerGroup) {
      groups.push(current);
      current = [node];
      continue;
    }

    const candidate = [...current, node];
    if (safeQuota) {
      const usage = await measureSummarizerUsage(summarizer, candidate.map((item) => item.text).join('\n\n'));
      if (usage !== null && usage > safeQuota) {
        groups.push(current);
        current = [node];
        continue;
      }
    }

    current.push(node);
  }

  if (current.length) groups.push(current);
  return groups;
}

async function ensureQuotaSafeDocumentChunks(chunks, summarizer, signal) {
  const safeQuota = getSummarizerSafeQuota(summarizer);
  if (!safeQuota) return chunks;

  const output = [];
  for (const chunk of chunks) {
    signal.throwIfAborted?.();
    await splitChunkUntilSafe(chunk, summarizer, safeQuota, output, signal);
  }
  return output.map((chunk, index) => ({
    ...chunk,
    id: `C${String(index + 1).padStart(3, '0')}`,
    order: index + 1,
  }));
}

async function splitChunkUntilSafe(chunk, summarizer, safeQuota, output, signal, depth = 0) {
  signal.throwIfAborted?.();
  const usage = await measureSummarizerUsage(summarizer, chunk.text);
  if (usage === null || usage <= safeQuota) {
    output.push(chunk);
    return;
  }

  if (depth > 8 || chunk.text.length < 500) {
    throw new Error('Gemini Nanoの入力上限に収まるようテキストを分割できませんでした。');
  }

  const targetChars = Math.max(500, Math.floor(chunk.text.length * (safeQuota / usage) * 0.82));
  let pieces = splitLongSegment(chunk.text, targetChars);
  if (pieces.length <= 1) {
    const midpoint = Math.ceil(chunk.text.length / 2);
    pieces = [chunk.text.slice(0, midpoint), chunk.text.slice(midpoint)];
  }

  for (const piece of pieces) {
    await splitChunkUntilSafe({ ...chunk, text: piece }, summarizer, safeQuota, output, signal, depth + 1);
  }
}

function summarizeLevelRecord(record) {
  return {
    level: record.level,
    inputCount: record.inputCount,
    groupCount: record.groupCount,
    aiCallCount: record.aiCallCount,
    passthroughCount: record.passthroughCount,
    outputCount: record.outputCount,
    inputCharactersTotal: record.inputCharactersTotal,
    outputCharactersTotal: record.outputCharactersTotal,
    compressionRatio: record.inputCharactersTotal
      ? record.outputCharactersTotal / record.inputCharactersTotal
      : null,
  };
}
