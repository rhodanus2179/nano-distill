import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCompressionPrompt, calculateCompressionRatio, classifyFinalLength } from '../src/ai.js';
import {
  DIAGNOSTIC_CONFIG,
  FINAL_SYSTEM_PROMPT,
  PIPELINE_CONFIG,
  SUMMARIZER_OPTIONS,
} from '../src/config.js';
import { createRunLog, createLevel, createAiCall, finishAiCall, recordAttempt } from '../src/diagnostics.js';
import { canFinalize, groupSummaryNodesForQuota } from '../src/pipeline.js';
import { createDocumentChunks } from '../src/text.js';

test('34 summaries are grouped into seven groups with fan-in <= 5', async () => {
  const nodes = Array.from({ length: 34 }, (_, index) => ({ id: `N${index + 1}`, text: `summary-${index + 1}` }));
  const summarizer = { inputQuota: 100000, async measureInputUsage(text) { return text.length; } };
  const groups = await groupSummaryNodesForQuota(nodes, summarizer, new AbortController().signal);
  assert.equal(groups.length, 7);
  assert.ok(groups.every((group) => group.length <= PIPELINE_CONFIG.maxSummariesPerGroup));
  assert.deepEqual(groups.map((group) => group.length), [5, 5, 5, 5, 5, 5, 4]);
});

test('quota can close a group before the fan-in limit', async () => {
  const nodes = Array.from({ length: 5 }, (_, index) => ({ id: `N${index + 1}`, text: 'x'.repeat(20) }));
  const summarizer = { inputQuota: 100, async measureInputUsage(text) { return text.length; } };
  const groups = await groupSummaryNodesForQuota(nodes, summarizer, new AbortController().signal);
  assert.deepEqual(groups.map((group) => group.length), [3, 2]);
});

test('finalization requires both source count and context fit', async () => {
  const session = {
    contextWindow: 1000,
    contextUsage: 0,
    async measureContextUsage(prompt) { return prompt.length; },
  };
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, text: '短い要約' }));
  const nine = [...eight, { id: '9', text: '短い要約' }];
  assert.equal(await canFinalize(session, eight), true);
  assert.equal(await canFinalize(session, nine), false);
});

test('relative compression ratio for 731 chars is about 55 percent', () => {
  const ratio = calculateCompressionRatio(731);
  assert.ok(ratio > 0.54 && ratio < 0.56);
});

test('final length classification uses deterministic JS boundaries', () => {
  assert.equal(classifyFinalLength('a'.repeat(299)), 'short');
  assert.equal(classifyFinalLength('a'.repeat(300)), 'normal');
  assert.equal(classifyFinalLength('a'.repeat(550)), 'normal');
  assert.equal(classifyFinalLength('a'.repeat(551)), 'long');
});

test('document chunk metadata retains page range', () => {
  const pages = [
    { pageNumber: 1, text: 'A'.repeat(100) },
    { pageNumber: 2, text: 'B'.repeat(100) },
    { pageNumber: 3, text: 'C'.repeat(100) },
  ];
  const chunks = createDocumentChunks(pages, 220, 0);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 2);
  assert.equal(chunks[1].pageStart, 3);
  assert.equal(chunks[1].pageEnd, 3);
});

test('diagnostic totals count logical calls separately from retries', () => {
  const log = createRunLog({ fileName: 'x.pdf', fileSize: 1, pageCount: 1, charCount: 10, emptyPageCount: 0 });
  const level = createLevel(log, { level: 1, inputCount: 1 });
  const call = createAiCall(level, {
    callId: 'L1-C001', phase: 'intermediate', level: 1, order: 1,
    source: { type: 'document-chunk', sourceIds: ['C001'] }, inputText: 'abc',
  });
  recordAttempt(log, call, { attempt: 1, state: 'start' });
  recordAttempt(log, call, { attempt: 1, state: 'timeout', elapsedMs: 100 });
  recordAttempt(log, call, { attempt: 2, state: 'start' });
  recordAttempt(log, call, { attempt: 2, state: 'success', elapsedMs: 50 });
  finishAiCall(log, level, call, { outputText: '要約', durationMs: 150 });
  assert.equal(log.totals.aiCallsStarted, 1);
  assert.equal(log.totals.retries, 1);
  assert.equal(log.totals.timeouts, 1);
  assert.equal(log.totals.aiCallsSucceeded, 1);
  assert.equal(call.attempts.length, 2);
});

test('recursive summarizer instruction requires coverage and fidelity', () => {
  assert.match(SUMMARIZER_OPTIONS.sharedContext, /各入力要約の主要論点/);
  assert.match(SUMMARIZER_OPTIONS.sharedContext, /一部の入力だけに偏らない/);
  assert.match(SUMMARIZER_OPTIONS.sharedContext, /略語の意味の推測をしない/);
  assert.match(SUMMARIZER_OPTIONS.sharedContext, /断定へ強めない/);
  assert.equal(DIAGNOSTIC_CONFIG.intermediatePromptTemplateVersion, 'intermediate-v3');
  assert.equal(DIAGNOSTIC_CONFIG.recursivePromptTemplateVersion, 'recursive-v4');
});

test('final prompt preserves terminology, statement type, and modality', () => {
  assert.match(FINAL_SYSTEM_PROMPT, /常体/);
  assert.match(FINAL_SYSTEM_PROMPT, /課題・制約/);
  assert.match(FINAL_SYSTEM_PROMPT, /推奨策・制度変更・結論へ言い換えてはいけません/);
  assert.match(FINAL_SYSTEM_PROMPT, /略語・略称の意味を推測して補足してはいけません/);
  assert.match(FINAL_SYSTEM_PROMPT, /断定へ強めてはいけません/);
  assert.equal(DIAGNOSTIC_CONFIG.finalPromptTemplateVersion, 'final-v4');
});

test('compression prompt preserves qualifiers and does not expand abbreviations', () => {
  const prompt = buildCompressionPrompt(0.59);
  assert.match(prompt, /略語の意味を推測して補足しない/);
  assert.match(prompt, /確実性・評価の強さ・前提条件を削らず/);
  assert.match(prompt, /断定へ強めない/);
  assert.match(prompt, /推奨策・制度変更・結論へ変換しない/);
  assert.equal(DIAGNOSTIC_CONFIG.compressionPromptTemplateVersion, 'relative-compression-v2');
});