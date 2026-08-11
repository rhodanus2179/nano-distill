import {
  FINAL_SYSTEM_PROMPT,
  PIPELINE_CONFIG,
  PROMPT_OPTIONS,
  SUMMARIZER_OPTIONS,
} from './config.js';
import { countChars } from './text.js';

export async function checkAiAvailability() {
  const support = {
    summarizerSupported: 'Summarizer' in globalThis,
    promptSupported: 'LanguageModel' in globalThis,
    summarizerAvailability: 'unavailable',
    promptAvailability: 'unavailable',
  };

  if (support.summarizerSupported) {
    try {
      support.summarizerAvailability = await Summarizer.availability(SUMMARIZER_OPTIONS);
    } catch {
      support.summarizerAvailability = 'unavailable';
    }
  }

  if (support.promptSupported) {
    try {
      support.promptAvailability = await LanguageModel.availability(PROMPT_OPTIONS);
    } catch {
      support.promptAvailability = 'unavailable';
    }
  }

  return support;
}

export function isAiUsable(status) {
  return status.summarizerSupported
    && status.promptSupported
    && status.summarizerAvailability !== 'unavailable'
    && status.promptAvailability !== 'unavailable';
}

export async function createIntermediateSummarizer({ onDownloadProgress } = {}) {
  if (!('Summarizer' in globalThis)) throw new Error('Summarizer APIが利用できません。');
  return Summarizer.create({
    ...SUMMARIZER_OPTIONS,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        onDownloadProgress?.(event.loaded ?? 0);
      });
    },
  });
}

export async function createFinalSession({ signal, onDownloadProgress } = {}) {
  if (!('LanguageModel' in globalThis)) throw new Error('Prompt APIが利用できません。');
  return LanguageModel.create({
    ...PROMPT_OPTIONS,
    signal,
    initialPrompts: [{ role: 'system', content: FINAL_SYSTEM_PROMPT }],
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        onDownloadProgress?.(event.loaded ?? 0);
      });
    },
  });
}

export async function summarizeUnit(summarizer, text, {
  signal,
  context,
  onAttempt,
  maxRetries = PIPELINE_CONFIG.maxRetries,
  timeoutMs = PIPELINE_CONFIG.unitTimeoutMs,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    signal?.throwIfAborted?.();
    const startedAt = performance.now();
    const timed = timeoutSignal(signal, timeoutMs);

    try {
      onAttempt?.({ attempt, state: 'start' });
      const summary = await summarizer.summarize(text, { context, signal: timed.signal });
      onAttempt?.({ attempt, state: 'success', elapsedMs: performance.now() - startedAt });
      return String(summary).trim();
    } catch (error) {
      lastError = error;
      const timedOut = timed.didTimeout();
      onAttempt?.({
        attempt,
        state: timedOut ? 'timeout' : 'error',
        elapsedMs: performance.now() - startedAt,
        error,
      });
      if (signal?.aborted) throw abortError();
      if (attempt > maxRetries || error?.name === 'QuotaExceededError') throw error;
    } finally {
      timed.cleanup();
    }
  }

  throw lastError ?? new Error('要約に失敗しました。');
}

export async function generateFinalSummary(session, sourceText, {
  signal,
  onPass,
  timeoutMs = PIPELINE_CONFIG.finalTimeoutMs,
} = {}) {
  const passes = [];
  let current = await runFinalPass(session, buildFinalPrompt(sourceText), {
    signal,
    timeoutMs,
    pass: 0,
    type: 'final-generation',
    requestedRatio: null,
    onPass,
  });
  passes.push(current);

  for (let pass = 1; pass <= PIPELINE_CONFIG.maxCompressionPasses; pass += 1) {
    if (classifyFinalLength(current.outputText) !== 'long') break;
    const requestedRatio = calculateCompressionRatio(countChars(current.outputText));
    try {
      const next = await runFinalPass(session, buildCompressionPrompt(requestedRatio), {
        signal,
        timeoutMs,
        pass,
        type: 'relative-compression',
        requestedRatio,
        onPass,
        inputText: current.outputText,
      });
      passes.push(next);
      current = next;
    } catch (error) {
      if (signal?.aborted) throw error;
      break;
    }
  }

  const finalText = current.outputText;
  return {
    text: finalText,
    lengthStatus: classifyFinalLength(finalText),
    passes,
  };
}

export function buildFinalPrompt(sourceText) {
  return `以下は一つの文書全体を段階的に圧縮した要約群です。全体を一つの簡潔な概要に統合してください。\n\n--- 入力 ---\n${sourceText}`;
}

export function buildCompressionPrompt(requestedRatio) {
  const percent = Math.round(requestedRatio * 100);
  return `直前の要約を、およそ${percent}%の長さに圧縮してください。目的、主要な実施内容、重要な結果・結論、重要な固有名詞・数値は保持してください。重複、細かな例示、一般論を優先して削除し、日本語として自然な一段落にしてください。要約本文だけを返してください。`;
}

export function classifyFinalLength(text) {
  const length = countChars(text);
  if (length < PIPELINE_CONFIG.finalNormalMinChars) return 'short';
  if (length > PIPELINE_CONFIG.finalNormalMaxChars) return 'long';
  return 'normal';
}

export function calculateCompressionRatio(currentLength) {
  const raw = PIPELINE_CONFIG.finalTargetChars / Math.max(currentLength, 1);
  return Math.min(
    PIPELINE_CONFIG.maxCompressionRatio,
    Math.max(PIPELINE_CONFIG.minCompressionRatio, raw),
  );
}

export async function canFitFinalPrompt(session, sourceText) {
  const prompt = buildFinalPrompt(sourceText);
  if (typeof session.measureContextUsage === 'function' && Number.isFinite(session.contextWindow)) {
    try {
      const usage = await session.measureContextUsage(prompt);
      const current = Number.isFinite(session.contextUsage) ? session.contextUsage : 0;
      return current + usage <= session.contextWindow * PIPELINE_CONFIG.finalContextSafetyRatio;
    } catch {
      // Fall through to a conservative character limit.
    }
  }
  return sourceText.length <= PIPELINE_CONFIG.fallbackFinalInputChars;
}

export async function measureSummarizerUsage(summarizer, text) {
  if (typeof summarizer.measureInputUsage !== 'function') return null;
  try {
    return await summarizer.measureInputUsage(text);
  } catch {
    return null;
  }
}

export function getSummarizerSafeQuota(summarizer) {
  if (!Number.isFinite(summarizer.inputQuota)) return null;
  return Math.floor(summarizer.inputQuota * PIPELINE_CONFIG.quotaSafetyRatio);
}

async function runFinalPass(session, prompt, {
  signal,
  timeoutMs,
  pass,
  type,
  requestedRatio,
  onPass,
  inputText = '',
}) {
  const startedAt = performance.now();
  const timed = timeoutSignal(signal, timeoutMs);
  const passRecord = {
    pass,
    type,
    inputCharacters: inputText ? countChars(inputText) : null,
    requestedRatio,
    outputText: '',
    outputCharacters: 0,
    durationMs: 0,
    status: 'running',
    error: null,
  };

  onPass?.({ ...passRecord, state: 'start' });
  try {
    const result = await session.prompt(prompt, { signal: timed.signal });
    passRecord.outputText = String(result).trim();
    passRecord.outputCharacters = countChars(passRecord.outputText);
    passRecord.durationMs = Math.round(performance.now() - startedAt);
    passRecord.status = 'success';
    onPass?.({ ...passRecord, state: 'success' });
    return passRecord;
  } catch (error) {
    passRecord.durationMs = Math.round(performance.now() - startedAt);
    passRecord.status = timed.didTimeout() ? 'timeout' : 'error';
    passRecord.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
    onPass?.({ ...passRecord, state: passRecord.status });
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    timed.cleanup();
  }
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal.reason);
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('処理がタイムアウトしました。', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

function abortError() {
  return new DOMException('処理を中止しました。', 'AbortError');
}
