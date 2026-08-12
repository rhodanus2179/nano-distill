import { APP_VERSION, DIAGNOSTIC_CONFIG, PIPELINE_CONFIG } from './config.js';
import { countChars, countParagraphs, countSentences } from './text.js';

export function createRunLog(documentData, extractionWarning = '') {
  const now = new Date();
  return {
    logFormatVersion: DIAGNOSTIC_CONFIG.logFormatVersion,
    logLevel: DIAGNOSTIC_CONFIG.logLevel,
    appVersion: APP_VERSION,
    runId: crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: now.toISOString(),
    endedAt: null,
    status: 'running',
    error: null,
    promptTemplates: {
      intermediate: DIAGNOSTIC_CONFIG.intermediatePromptTemplateVersion,
      recursive: DIAGNOSTIC_CONFIG.recursivePromptTemplateVersion,
      final: DIAGNOSTIC_CONFIG.finalPromptTemplateVersion,
      finalRewrite: DIAGNOSTIC_CONFIG.finalRewritePromptTemplateVersion,
    },
    document: {
      fileName: documentData.fileName,
      fileSize: documentData.fileSize,
      pageCount: documentData.pageCount,
      characterCount: documentData.charCount,
      emptyPageCount: documentData.emptyPageCount,
    },
    config: structuredCloneSafe(PIPELINE_CONFIG),
    extraction: {
      extractedPageCount: documentData.extractedPageCount ?? documentData.pageCount - documentData.emptyPageCount,
      emptyPageNumbers: [...(documentData.emptyPageNumbers ?? [])],
      warning: extractionWarning || null,
    },
    initialChunks: [],
    levels: [],
    finalization: {
      sourceIds: [],
      sourceCount: 0,
      sourceCharacters: 0,
      passes: [],
      finalText: '',
      finalCharacters: 0,
      finalSentences: 0,
      finalParagraphs: 0,
      lengthStatus: null,
    },
    totals: {
      aiCallsStarted: 0,
      aiCallsSucceeded: 0,
      aiCallsFailed: 0,
      retries: 0,
      timeouts: 0,
      recursionLevels: 0,
      initialChunkCount: 0,
      totalDurationMs: 0,
    },
  };
}

export function recordInitialChunks(log, chunks) {
  if (!log) return;
  log.initialChunks = chunks.map((chunk) => ({
    id: chunk.id,
    order: chunk.order,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    characters: countChars(chunk.text),
  }));
  log.totals.initialChunkCount = chunks.length;
}

export function createLevel(log, { level, inputCount, groupCount = inputCount }) {
  if (!log) return null;
  const record = {
    level,
    inputCount,
    groupCount,
    aiCallCount: 0,
    passthroughCount: 0,
    outputCount: 0,
    inputCharactersTotal: 0,
    outputCharactersTotal: 0,
    durationMs: 0,
    nodes: [],
  };
  log.levels.push(record);
  return record;
}

export function createAiCall(levelRecord, {
  callId,
  phase,
  level,
  order,
  source,
  inputText,
  itemCount = 1,
  measuredUsage = null,
  inputQuota = null,
  context = null,
}) {
  const call = {
    callId,
    phase,
    level,
    order,
    source: structuredCloneSafe(source),
    input: {
      itemCount,
      characters: countChars(inputText),
      measuredUsage,
      inputQuota,
    },
    context,
    output: {
      text: '',
      characters: 0,
    },
    attempts: [],
    durationMs: 0,
    status: 'running',
    aiCall: true,
  };
  levelRecord?.nodes.push(call);
  if (levelRecord) {
    levelRecord.aiCallCount += 1;
    levelRecord.inputCharactersTotal += call.input.characters;
  }
  return call;
}

export function recordAttempt(log, call, info) {
  if (!log || !call) return;
  const status = info.state === 'success' ? 'success'
    : info.state === 'timeout' ? 'timeout'
      : info.state === 'error' ? 'error'
        : 'started';

  if (info.state === 'start') {
    if (info.attempt === 1) log.totals.aiCallsStarted += 1;
    else log.totals.retries += 1;
  }
  if (info.state === 'timeout') log.totals.timeouts += 1;

  if (info.state === 'start') {
    call.attempts.push({
      attempt: info.attempt,
      status,
      durationMs: 0,
      error: null,
    });
    return;
  }

  const attempt = [...call.attempts].reverse().find((entry) => entry.attempt === info.attempt)
    ?? { attempt: info.attempt, status: 'started', durationMs: 0, error: null };
  if (!call.attempts.includes(attempt)) call.attempts.push(attempt);
  attempt.status = status;
  attempt.durationMs = Math.round(info.elapsedMs ?? 0);
  attempt.error = serializeError(info.error);
}

export function finishAiCall(log, levelRecord, call, { outputText, durationMs, status = 'success', error = null }) {
  if (!log || !call) return;
  call.output.text = outputText ?? '';
  call.output.characters = countChars(call.output.text);
  call.durationMs = Math.round(durationMs ?? 0);
  call.status = status;
  call.error = serializeError(error);

  if (status === 'success') log.totals.aiCallsSucceeded += 1;
  else log.totals.aiCallsFailed += 1;

  if (levelRecord) {
    levelRecord.outputCharactersTotal += call.output.characters;
    levelRecord.durationMs += call.durationMs;
  }
}

export function recordPassthrough(levelRecord, { nodeId, level, order, sourceIds, text }) {
  if (!levelRecord) return null;
  const node = {
    nodeId,
    phase: 'passthrough',
    level,
    order,
    sourceIds: [...sourceIds],
    output: {
      text,
      characters: countChars(text),
    },
    aiCall: false,
  };
  levelRecord.nodes.push(node);
  levelRecord.passthroughCount += 1;
  levelRecord.inputCharactersTotal += node.output.characters;
  levelRecord.outputCharactersTotal += node.output.characters;
  return node;
}

export function finishLevel(log, levelRecord, outputCount) {
  if (!log || !levelRecord) return;
  levelRecord.outputCount = outputCount;
  log.totals.recursionLevels = Math.max(log.totals.recursionLevels, levelRecord.level);
}

export function beginFinalization(log, sourceNodes) {
  if (!log) return;
  log.finalization.sourceIds = sourceNodes.map((node) => node.id);
  log.finalization.sourceCount = sourceNodes.length;
  log.finalization.sourceCharacters = sourceNodes.reduce((sum, node) => sum + countChars(node.text), 0);
}

export function recordFinalPass(log, passRecord) {
  if (!log) return;
  const outputText = passRecord.outputText ?? '';
  const record = {
    ...structuredCloneSafe(passRecord),
    outputCharacters: countChars(outputText),
    outputSentences: countSentences(outputText),
    outputParagraphs: countParagraphs(outputText),
  };
  log.finalization.passes.push(record);
  log.totals.aiCallsStarted += 1;
  if (record.status === 'success') log.totals.aiCallsSucceeded += 1;
  else log.totals.aiCallsFailed += 1;
  if (record.status === 'timeout') log.totals.timeouts += 1;
}

export function finishFinalization(log, { finalText, lengthStatus }) {
  if (!log) return;
  log.finalization.finalText = finalText;
  log.finalization.finalCharacters = countChars(finalText);
  log.finalization.finalSentences = countSentences(finalText);
  log.finalization.finalParagraphs = countParagraphs(finalText);
  log.finalization.lengthStatus = lengthStatus;
}

export function finishRun(log, { status, startedAtMs, error = null }) {
  if (!log || log.endedAt) return;
  log.status = status;
  log.endedAt = new Date().toISOString();
  log.error = serializeError(error);
  log.totals.totalDurationMs = Math.round(performance.now() - startedAtMs);
}

export function exportRunLogJson(log) {
  if (!log) throw new Error('保存できる診断ログがありません。');
  return JSON.stringify(log, null, 2);
}

export function downloadRunLog(log) {
  const json = exportRunLogJson(log);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nano-distill-debug-${safeIsoTimestamp(new Date())}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeIsoTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}
