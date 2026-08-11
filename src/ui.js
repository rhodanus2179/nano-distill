import { countChars, formatBytes } from './text.js';

export function createUi() {
  const $ = (id) => document.getElementById(id);
  const els = {
    aiStatus: $('aiStatus'),
    modelDownloadWrap: $('modelDownloadWrap'),
    modelDownloadLabel: $('modelDownloadLabel'),
    modelDownloadProgress: $('modelDownloadProgress'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    documentCard: $('documentCard'),
    fileName: $('fileName'),
    pageCount: $('pageCount'),
    fileSize: $('fileSize'),
    charCount: $('charCount'),
    emptyPages: $('emptyPages'),
    extractionWarning: $('extractionWarning'),
    startButton: $('startButton'),
    changeFileButton: $('changeFileButton'),
    progressCard: $('progressCard'),
    progressTitle: $('progressTitle'),
    progressBar: $('progressBar'),
    progressDetail: $('progressDetail'),
    elapsedTime: $('elapsedTime'),
    levelList: $('levelList'),
    attemptInfo: $('attemptInfo'),
    cancelButton: $('cancelButton'),
    saveLogButton: $('saveLogButton'),
    logWarning: $('logWarning'),
    resultCard: $('resultCard'),
    summaryText: $('summaryText'),
    summaryChars: $('summaryChars'),
    resultStats: $('resultStats'),
    lengthStatus: $('lengthStatus'),
    lengthHistory: $('lengthHistory'),
    copyButton: $('copyButton'),
    clearDataButton: $('clearDataButton'),
    clearDataDialog: $('clearDataDialog'),
    storageUsage: $('storageUsage'),
  };

  return {
    els,
    setAiStatus(status) {
      if (!status.summarizerSupported || !status.promptSupported) {
        els.aiStatus.textContent = 'このChromeでは未対応';
        return;
      }
      const states = [status.summarizerAvailability, status.promptAvailability];
      if (states.includes('unavailable')) els.aiStatus.textContent = '利用不可';
      else if (states.includes('downloadable')) els.aiStatus.textContent = 'モデルのダウンロードが必要';
      else if (states.includes('downloading')) els.aiStatus.textContent = 'モデルをダウンロード中';
      else els.aiStatus.textContent = '利用可能';
    },
    setModelDownload(value, label = 'モデルを準備中…') {
      const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
      els.modelDownloadWrap.hidden = false;
      els.modelDownloadLabel.textContent = `${label} ${percent}%`;
      els.modelDownloadProgress.value = percent;
      if (percent >= 100) setTimeout(() => { els.modelDownloadWrap.hidden = true; }, 900);
    },
    showExtracting(file) {
      els.dropZone.hidden = true;
      els.documentCard.hidden = false;
      els.fileName.textContent = file.name;
      els.pageCount.textContent = '読込中…';
      els.fileSize.textContent = formatBytes(file.size);
      els.charCount.textContent = '—';
      els.emptyPages.textContent = '—';
      els.startButton.disabled = true;
      els.resultCard.hidden = true;
      els.progressCard.hidden = true;
      els.extractionWarning.hidden = true;
    },
    updateExtractionProgress(pageNumber, pageCount) {
      els.pageCount.textContent = `${pageNumber} / ${pageCount}`;
    },
    showDocument(documentData, warning) {
      els.fileName.textContent = documentData.fileName;
      els.pageCount.textContent = `${documentData.pageCount}ページ`;
      els.fileSize.textContent = formatBytes(documentData.fileSize);
      els.charCount.textContent = documentData.charCount.toLocaleString('ja-JP');
      els.emptyPages.textContent = `${documentData.emptyPageCount}ページ`;
      els.startButton.disabled = documentData.charCount === 0;
      if (warning) {
        els.extractionWarning.textContent = warning;
        els.extractionWarning.hidden = false;
      } else {
        els.extractionWarning.hidden = true;
      }
    },
    reset() {
      els.fileInput.value = '';
      els.dropZone.hidden = false;
      els.documentCard.hidden = true;
      els.progressCard.hidden = true;
      els.resultCard.hidden = true;
      els.levelList.replaceChildren();
      els.attemptInfo.textContent = '';
      els.progressBar.value = 0;
      els.saveLogButton.disabled = true;
      els.logWarning.hidden = true;
    },
    beginProcessing() {
      els.progressCard.hidden = false;
      els.resultCard.hidden = true;
      els.startButton.disabled = true;
      els.changeFileButton.disabled = true;
      els.progressBar.value = 0;
      els.levelList.replaceChildren();
      els.attemptInfo.textContent = '';
      els.lengthHistory.replaceChildren();
    },
    endProcessing() {
      els.startButton.disabled = false;
      els.changeFileButton.disabled = false;
    },
    setStage(title) {
      els.progressTitle.textContent = title;
    },
    setProgress({ level, index, total }) {
      const percent = total ? Math.round((index / total) * 100) : 0;
      els.progressBar.value = percent;
      els.progressDetail.textContent = `第${level}層：${Math.min(index + 1, total)} / ${total}`;
    },
    addLevel(level) {
      const li = document.createElement('li');
      const passthrough = level.passthroughCount ? ` / pass-through ${level.passthroughCount}` : '';
      li.textContent = `第${level.level}層 ${level.inputCount} → ${level.outputCount}${passthrough}`;
      els.levelList.append(li);
    },
    setAttempt(info) {
      if (info.state === 'start') {
        const target = `第${info.level}層 ${info.index + 1}/${info.total}`;
        els.attemptInfo.textContent = `${target} — attempt ${info.attempt}`;
      } else if (info.state === 'timeout') {
        els.attemptInfo.textContent = 'タイムアウト。再試行します…';
      } else if (info.state === 'error') {
        els.attemptInfo.textContent = '一時的なエラー。再試行します…';
      }
    },
    setFinalPass(info) {
      if (info.state === 'start') {
        if (info.type === 'relative-compression') {
          els.attemptInfo.textContent = `最終要約を約${Math.round(info.requestedRatio * 100)}%へ再圧縮中…`;
        } else {
          els.attemptInfo.textContent = '最終要約を生成中…';
        }
      }
    },
    setElapsed(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      els.elapsedTime.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    },
    setLogAvailable(available) {
      els.saveLogButton.disabled = !available;
      els.logWarning.hidden = !available;
    },
    showResult(result) {
      els.summaryText.textContent = result.finalSummary;
      els.summaryChars.textContent = countChars(result.finalSummary).toLocaleString('ja-JP');
      els.resultStats.textContent = `${result.initialChunkCount}初期チャンク / ${result.levels.length}階層 / Final入力 ${result.finalSourceCount}件 / AI ${result.totalAiCalls}回`;
      els.lengthStatus.textContent = lengthStatusLabel(result.finalLengthStatus);
      els.lengthStatus.dataset.status = result.finalLengthStatus;
      els.lengthHistory.replaceChildren();
      for (const item of result.finalLengthHistory) {
        const li = document.createElement('li');
        const ratio = item.requestedRatio ? ` / 約${Math.round(item.requestedRatio * 100)}%指定` : '';
        li.textContent = `pass ${item.pass}: ${item.characters}字${ratio}`;
        els.lengthHistory.append(li);
      }
      els.resultCard.hidden = false;
      els.progressBar.value = 100;
      els.progressDetail.textContent = '完了';
      els.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    showError(message) {
      els.progressTitle.textContent = 'エラー';
      els.progressDetail.textContent = message;
      els.attemptInfo.textContent = '';
    },
    setStorageUsage(text) {
      els.storageUsage.textContent = text;
    },
  };
}

function lengthStatusLabel(status) {
  if (status === 'short') return '短めの要約です';
  if (status === 'long') return '目安より長めの要約です';
  return '目標範囲';
}
