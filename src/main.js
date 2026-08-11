import { checkAiAvailability, isAiUsable } from './ai.js';
import { PIPELINE_CONFIG } from './config.js';
import { extractPdfText } from './pdf.js';
import { RecursiveSummaryPipeline } from './pipeline.js';
import { clearSiteData, getSiteStorageSummary } from './storage.js';
import { createUi } from './ui.js';

const ui = createUi();
let currentDocument = null;
let currentExtractionWarning = '';
let extractionController = null;
let elapsedTimer = null;
let processingStartedAt = 0;
let aiStatus = null;

const pipeline = new RecursiveSummaryPipeline({
  onStage: ({ title }) => ui.setStage(title),
  onProgress: (progress) => ui.setProgress(progress),
  onLevelComplete: (level) => ui.addLevel(level),
  onAttempt: (info) => ui.setAttempt(info),
  onFinalPass: (info) => ui.setFinalPass(info),
  onModelDownload: (loaded) => ui.setModelDownload(loaded),
  onLogAvailability: (available) => ui.setLogAvailable(available),
});

initialize();

async function initialize() {
  wireEvents();
  await refreshStorageUsage();
  aiStatus = await checkAiAvailability();
  ui.setAiStatus(aiStatus);
}

function wireEvents() {
  const { els } = ui;

  els.dropZone.addEventListener('click', () => els.fileInput.click());
  els.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  for (const eventName of ['dragenter', 'dragover']) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('is-dragging');
    });
  }

  els.dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    if (file) loadFile(file);
  });

  els.startButton.addEventListener('click', startSummary);
  els.cancelButton.addEventListener('click', () => {
    pipeline.abort();
    stopElapsedTimer();
    ui.endProcessing();
    ui.setStage('中止しました');
    ui.els.progressDetail.textContent = '処理はユーザー操作で中止されました。診断ログは保存できます。';
  });
  els.saveLogButton.addEventListener('click', () => {
    try {
      pipeline.saveDiagnosticLog();
    } catch (error) {
      ui.showError(friendlyError(error));
    }
  });
  els.changeFileButton.addEventListener('click', resetDocument);
  els.copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(els.summaryText.textContent ?? '');
    const previous = els.copyButton.textContent;
    els.copyButton.textContent = 'コピーしました';
    setTimeout(() => { els.copyButton.textContent = previous; }, 1200);
  });

  els.clearDataButton.addEventListener('click', () => els.clearDataDialog.showModal());
  els.clearDataDialog.addEventListener('close', async () => {
    if (els.clearDataDialog.returnValue !== 'confirm') return;
    pipeline.reset();
    extractionController?.abort();
    stopElapsedTimer();
    currentDocument = null;
    currentExtractionWarning = '';
    await clearSiteData();
    ui.reset();
    await refreshStorageUsage();
  });
}

async function loadFile(file) {
  pipeline.reset();
  extractionController?.abort();
  extractionController = new AbortController();
  currentDocument = null;
  currentExtractionWarning = '';
  ui.showExtracting(file);

  try {
    const documentData = await extractPdfText(file, {
      signal: extractionController.signal,
      onProgress: ({ pageNumber, pageCount }) => ui.updateExtractionProgress(pageNumber, pageCount),
    });
    currentDocument = documentData;
    currentExtractionWarning = getExtractionWarning(documentData);
    ui.showDocument(documentData, currentExtractionWarning);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    ui.showDocument({
      fileName: file.name,
      fileSize: file.size,
      pageCount: 0,
      emptyPageCount: 0,
      charCount: 0,
    }, `PDFの読み込みに失敗しました：${friendlyError(error)}`);
  } finally {
    extractionController = null;
  }
}

async function startSummary() {
  if (!currentDocument) return;
  if (!aiStatus || !isAiUsable(aiStatus)) {
    aiStatus = await checkAiAvailability();
    ui.setAiStatus(aiStatus);
  }
  if (!isAiUsable(aiStatus)) {
    ui.beginProcessing();
    ui.showError('Gemini NanoのSummarizer APIまたはPrompt APIを利用できません。Chromeの対応状況とモデル設定を確認してください。');
    ui.endProcessing();
    return;
  }

  ui.beginProcessing();
  processingStartedAt = performance.now();
  startElapsedTimer();

  try {
    const result = await pipeline.run(currentDocument, { extractionWarning: currentExtractionWarning });
    stopElapsedTimer();
    ui.setElapsed(result.elapsedMs);
    ui.showResult(result);
  } catch (error) {
    stopElapsedTimer();
    if (error?.name === 'AbortError') {
      ui.setStage('中止しました');
      ui.els.progressDetail.textContent = '処理は中止されました。診断ログは保存できます。';
    } else {
      console.error(error);
      ui.showError(friendlyError(error));
    }
  } finally {
    ui.endProcessing();
    await refreshStorageUsage();
  }
}

function resetDocument() {
  pipeline.reset();
  extractionController?.abort();
  stopElapsedTimer();
  currentDocument = null;
  currentExtractionWarning = '';
  ui.reset();
}

function getExtractionWarning(documentData) {
  if (documentData.charCount === 0) {
    return 'このPDFからテキストを抽出できませんでした。画像として保存されたスキャンPDFの可能性があります。v0.2ではOCRに対応していません。';
  }
  const average = documentData.charCount / Math.max(documentData.pageCount, 1);
  if (average < PIPELINE_CONFIG.suspiciousCharsPerPage) {
    return '抽出できた文字数がページ数に対して少なめです。スキャン画像中心のPDFや、テキストレイヤーが不完全なPDFの可能性があります。';
  }
  return '';
}

function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => ui.setElapsed(performance.now() - processingStartedAt), 500);
}

function stopElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

async function refreshStorageUsage() {
  ui.setStorageUsage(await getSiteStorageSummary());
}

function friendlyError(error) {
  if (!error) return '不明なエラーが発生しました。';
  if (error.name === 'QuotaExceededError') return 'Gemini Nanoの入力上限を超えました。チャンク分割条件の調整が必要です。';
  if (error.name === 'NotSupportedError') return 'この入力言語またはAI機能は現在のChrome環境でサポートされていません。';
  if (error.name === 'TimeoutError') return 'Gemini Nanoの処理がタイムアウトしました。';
  return error.message || String(error);
}
