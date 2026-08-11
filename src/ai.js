import {
  FINAL_SYSTEM_PROMPT,
  PIPELINE_CONFIG,
  PROMPT_OPTIONS,
  SUMMARIZER_OPTIONS,
} from './config.js';

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
    initialPrompts: [
      { role: 'system', content: FINAL_SYSTEM_PROMPT },
    ],
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
      const summary = await summarizer.summarize(text, {
        context,
        signal: timed.signal,
      });
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
  onAttempt,
  timeoutMs = PIPELINE_CONFIG.finalTimeoutMs,
} = {}) {
  const prompt = buildFinalPrompt(sourceText);
  const first = await promptWithTimeout(session, prompt, { signal, timeoutMs, onAttempt, label: 'final' });
  const firstLength = Array.from(first).length;

  if (firstLength >= 330 && firstLength <= 480) return first;

  const correction = `直前の要約を、情報を落としすぎず350〜450字程度に調整してください。要約本文だけを返してください。現在は${firstLength}字です。`;
  try {
    return await promptWithTimeout(session, correction, { signal, timeoutMs, onAttempt, label: 'length-adjust' });
  } catch {
    return first;
  }
}

export function buildFinalPrompt(sourceText) {
  return `以下は同一文書を段階的に要約した内容です。重複を整理し、文書全体の要約を350〜450字程度で作成してください。\n\n--- 入力 ---\n${sourceText}`;
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

async function promptWithTimeout(session, prompt, { signal, timeoutMs, onAttempt, label }) {
  const startedAt = performance.now();
  const timed = timeoutSignal(signal, timeoutMs);
  try {
    onAttempt?.({ attempt: 1, state: 'start', label });
    const result = await session.prompt(prompt, { signal: timed.signal });
    onAttempt?.({ attempt: 1, state: 'success', label, elapsedMs: performance.now() - startedAt });
    return String(result).trim();
  } catch (error) {
    onAttempt?.({ attempt: 1, state: timed.didTimeout() ? 'timeout' : 'error', label, elapsedMs: performance.now() - startedAt, error });
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
