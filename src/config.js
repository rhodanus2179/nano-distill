export const APP_VERSION = '0.2.1';

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
  sharedContext: '業務報告書、調査報告書、仕様書、技術資料などの長文書を段階的に要約する。重要な目的、対象、実施内容、結果、結論、固有名詞、数値、条件を可能な限り保持し、原文にない推測を加えない。入力が複数の要約で構成される場合は、重複を整理しつつ、各入力要約の主要論点を原則として少なくとも1つずつ反映し、一部の入力だけに偏らない。課題・原因・実施事項・結果・今後の検討や提案を区別し、入力に明示されていない提案や因果関係へ変換しない。制度名・事業名・組織名・技術名・略語は入力中の表記を尊重し、類義語への置換や略語の意味の推測をしない。略語の正式名称は入力中に対応関係が明示されている場合のみ用いる。「限定的」「可能性がある」「示唆された」「見込まれる」「未確認」「仮定」「試算」など、確実性や条件を表す語を保持し、断定へ強めない。',
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
文体は簡潔な常体（だ・である調）を原則としてください。ただし、文体を整えるために内容や意味を変更してはいけません。
重要な固有名詞、数値、条件は必要に応じて保持してください。制度名・事業名・組織名・技術名などは入力中の表記を尊重し、似た別表現へ勝手に言い換えないでください。
略語・略称の意味を推測して補足してはいけません。正式名称との対応が入力中に明示されている場合のみ、その対応関係を用いてください。
重複した説明、細かな例示、一般論は優先して削ってください。
入力中の「課題・制約」「原因・理由」「実施したこと」「得られた結果」「今後の検討・提案」を区別したまま保持してください。課題や原因を、入力に明示されていない推奨策・制度変更・結論へ言い換えてはいけません。
「限定的」「可能性がある」「示唆された」「見込まれる」「未確認」「仮定」「試算」など、確実性・評価の強さ・前提条件を表す表現を保持し、短縮のために断定へ強めてはいけません。
特に、「基準が厳しい」「コストが高い」「精度が低い」などの問題記述だけを根拠に、「基準を緩和すべき」「補助すべき」などの処方箋を新たに作らないでください。
技術用語・固有名詞を除き、不自然な外国語表現を混在させないでください。入力にない事実を追加・推測しないでください。
見出し、箇条書き、前置き、文字数の説明は出力せず、要約本文だけを返してください。
400字前後は目安であり、厳密に文字数を数える必要はありません。`;

export const DIAGNOSTIC_CONFIG = Object.freeze({
  logFormatVersion: '1.0',
  logLevel: 'standard',
  intermediatePromptTemplateVersion: 'intermediate-v3',
  recursivePromptTemplateVersion: 'recursive-v4',
  finalPromptTemplateVersion: 'final-v4',
  compressionPromptTemplateVersion: 'relative-compression-v2',
});