export const APP_VERSION = '0.2.0';

export const PDFJS_VERSION = '5.7.284';
export const PDFJS_MODULE_URL = '../vendor/pdfjs/pdf.min.mjs';
export const PDFJS_WORKER_URL = '../vendor/pdfjs/pdf.worker.min.mjs';

export const PIPELINE_CONFIG = Object.freeze({
  initialChunkChars: 6000,
  chunkOverlapChars: 180,
  quotaSafetyRatio: 0.72,
  finalContextSafetyRatio: 0.80,
  fallbackFinalInputChars: 9000,

  maxSummariesPerGroup: 5,
  maxFinalSourceItems: 8,

  finalTargetChars: 400,
  finalNormalMinChars: 300,
  finalNormalMaxChars: 550,
  maxCompressionPasses: 2,
  minCompressionRatio: 0.45,
  maxCompressionRatio: 0.85,

  maxRecursionLevels: 12,
  maxRetries: 2,
  unitTimeoutMs: 180_000,
  finalTimeoutMs: 180_000,
  suspiciousCharsPerPage: 20,
});

export const SUMMARIZER_OPTIONS = Object.freeze({
  type: 'tldr',
  format: 'plain-text',
  length: 'long',
  preference: 'capability',
  sharedContext: '業務報告書、調査報告書、仕様書、技術資料などの長文書を段階的に要約する。重要な目的、対象、実施内容、結果、結論、固有名詞、数値、条件を可能な限り保持し、原文にない推測を加えない。',
  expectedInputLanguages: ['ja', 'en'],
  outputLanguage: 'ja',
  expectedContextLanguages: ['ja'],
});

export const PROMPT_OPTIONS = Object.freeze({
  expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
});

export const FINAL_SYSTEM_PROMPT = `あなたは業務文書の要約担当です。入力は同一文書を段階的に圧縮した要約群です。
文書の目的、対象、主な実施・検討内容、主要な結果・結論が独立して読んでも分かるように、簡潔な一段落の自然な日本語として統合してください。
重要な固有名詞、数値、条件は必要に応じて保持してください。重複した説明、細かな例示、一般論は優先して削ってください。
技術用語・固有名詞を除き、不自然な外国語表現を混在させないでください。入力にない事実を追加・推測しないでください。
見出し、箇条書き、前置き、文字数の説明は出力せず、要約本文だけを返してください。
400字前後は目安であり、厳密に文字数を数える必要はありません。`;

export const DIAGNOSTIC_CONFIG = Object.freeze({
  logFormatVersion: '1.0',
  logLevel: 'standard',
  intermediatePromptTemplateVersion: 'intermediate-v2',
  recursivePromptTemplateVersion: 'recursive-v2',
  finalPromptTemplateVersion: 'final-v2',
  compressionPromptTemplateVersion: 'relative-compression-v1',
});
