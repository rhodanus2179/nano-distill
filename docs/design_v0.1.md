# nano-distill 設計書 v0.1

作成日: 2026-08-11

## 1. 設計目的

`nano-distill` v0.1 は、長大なテキストPDFをブラウザへドラッグ＆ドロップし、PDF.jsでテキストを抽出した後、Chrome Built-in AI / Gemini Nanoで段階的に圧縮し、最終的に日本語約400字の要約を生成する静的Webアプリケーションとする。

初版では「高機能な文書分析」よりも、100～200ページ級のPDFでも処理を破綻させず、再帰的に要約を完走できることを優先する。

---

## 2. v0.1 のスコープ

### 2.1 実装対象

- 単一PDFのドラッグ＆ドロップ / ファイル選択
- PDF.jsによるページ単位のテキスト抽出
- 基本的なテキスト正規化
- 入力上限を考慮したチャンク分割
- Gemini Nanoによるチャンク単位の逐次要約
- 要約群の再グループ化と再帰要約
- 最終350～450字程度の日本語要約
- 進捗表示
- 処理中止
- 単位処理の再試行
- エラー表示
- 最終要約のコピー
- 処理統計の表示

### 2.2 v0.1 では実装しないもの

- OCR
- 画像PDFからの文字認識
- PDF以外のファイル入力
- 複数PDF一括処理
- タグ生成
- 固有名詞・発注者・年度等の構造化抽出
- 業務実績DB連携
- 中間結果の永続保存
- クラウドLLMフォールバック
- RAG / ベクトル検索
- モバイル対応
- 高度なPDFレイアウト復元
- 表・図の意味解析

---

## 3. 技術方針

### 3.1 基本構成

バックエンドを持たない静的Webアプリとする。

```text
Browser (Desktop Chrome)
│
├─ UI
│   ├─ PDF Drop Zone
│   ├─ Document Info
│   ├─ Progress
│   └─ Final Summary
│
├─ PDF Layer
│   └─ PDF.js
│       └─ page.getTextContent()
│
├─ Text Layer
│   ├─ normalize
│   └─ chunk
│
├─ Pipeline Layer
│   └─ recursive summarization controller
│
└─ AI Layer
    ├─ Summarizer API
    │   └─ intermediate / recursive summarization
    └─ Prompt API
        └─ final 350–450 character synthesis
```

### 3.2 AI APIの役割分担

#### 中間・再帰要約: Summarizer API

長文の反復圧縮には Chrome Summarizer API を使用する。

理由:

1. 要約専用APIであり、v0.1 の主処理に適合する。
2. Chrome公式が長文向けに「summary of summaries」および再帰的なsummary of summariesを案内している。
3. `inputQuota` と `measureInputUsage()` を利用し、実際のモデル入力上限を考慮した分割設計が可能である。
4. `type: "tldr"`, `format: "plain-text"`, `length: "long"` を基本設定として、上位要約に必要な情報をある程度保持できる。

基本オプション:

```js
{
  type: 'tldr',
  format: 'plain-text',
  length: 'long',
  preference: 'capability',
  expectedInputLanguages: ['ja', 'en'],
  outputLanguage: 'ja'
}
```

`preference` が実行環境で利用できない場合は、省略して動作する実装とする。

#### 最終整形: Prompt API

Summarizer API の `tldr/long` は文章長を「最大5文」として制御するため、350～450字という日本語文字数要件を直接保証できない。

そのため、再帰圧縮によって十分小さくなった最上位要約のみを fresh な Prompt API session に渡し、最終要約を生成する。

最終プロンプトの主な要求:

- 350～450字程度
- 日本語
- 文書の目的、対象、主要内容、結果・結論を含む
- 固有名詞、重要数値・条件は必要に応じて保持
- 原文にない内容を推測しない
- 前置きや箇条書きを付けず、要約本文のみ出力

最終化処理は1回を基本とし、文字数が大きく逸脱した場合のみ最大1回再試行する。

---

## 4. 対象実行環境

### 4.1 v0.1 のサポート対象

- Desktop Chrome
- Windows 10 / 11を主対象
- Chrome Built-in AIが利用可能な端末
- 日本語入力・出力が利用可能なモデル環境

### 4.2 起動時チェック

以下を確認する。

1. `PDF.js` がロード済みか
2. `Summarizer` が存在するか
3. `Summarizer.availability()` の状態
4. `LanguageModel` が存在するか
5. `LanguageModel.availability()` の状態

AIモデルの状態は以下に正規化してUIへ表示する。

```text
unavailable
available
needs-download
preparing
error
```

Chrome API自体の実値が `downloadable` / `downloading` 等である場合はUI内部状態へマッピングする。

モデルダウンロードが必要な場合は、ユーザー操作を契機に `create()` を実行し、download progressを表示する。

---

## 5. 配布方式

### 5.1 静的ファイル

npm buildを必須としない。

HTML / CSS / ES Modulesで構成し、Webサーバー上へそのまま配置可能とする。

### 5.2 PDF.js

PDF.jsはCDN依存ではなく、リポジトリ内に必要ファイルを配置する方針とする。

理由:

- アプリ本体の外部通信依存を減らす
- バージョンを固定できる
- 将来的なイントラネット等への配置を容易にする

想定:

```text
vendor/
└─ pdfjs/
   ├─ pdf.mjs
   └─ pdf.worker.mjs
```

ライセンス表記を保持する。

---

## 6. ディレクトリ構成案

```text
nano-distill/
├─ index.html
├─ styles.css
├─ README.md
├─ src/
│  ├─ main.js
│  ├─ config.js
│  ├─ state.js
│  │
│  ├─ pdf/
│  │  └─ extract-text.js
│  │
│  ├─ text/
│  │  ├─ normalize.js
│  │  └─ chunk.js
│  │
│  ├─ ai/
│  │  ├─ capabilities.js
│  │  ├─ summarizer.js
│  │  └─ finalizer.js
│  │
│  ├─ pipeline/
│  │  └─ recursive-summary.js
│  │
│  └─ ui/
│     ├─ render.js
│     └─ events.js
│
├─ vendor/
│  └─ pdfjs/
│     ├─ pdf.mjs
│     └─ pdf.worker.mjs
│
└─ docs/
   └─ design_v0.1.md
```

初版から責務分離を行い、巨大な単一 `app.js` に全処理を集約しない。

---

## 7. データモデル

### 7.1 DocumentData

```js
{
  fileName: string,
  fileSize: number,
  pageCount: number,
  extractedPageCount: number,
  emptyPageCount: number,
  characterCount: number,
  pages: PageText[]
}
```

### 7.2 PageText

```js
{
  pageNumber: number,
  text: string,
  characterCount: number,
  extractionWarning: string | null
}
```

### 7.3 Chunk

```js
{
  id: string,
  level: number,
  order: number,
  pageStart: number | null,
  pageEnd: number | null,
  sourceIds: string[],
  text: string,
  characterCount: number,
  measuredUsage: number | null
}
```

Level 0 はPDF原文チャンク、Level 1以降は要約から作成されたチャンクとする。

### 7.4 SummaryNode

```js
{
  id: string,
  level: number,
  order: number,
  sourceIds: string[],
  text: string,
  characterCount: number,
  attempts: number,
  durationMs: number,
  status: 'pending' | 'running' | 'done' | 'failed'
}
```

### 7.5 RunState

```js
{
  runId: string,
  status: 'idle' | 'extracting' | 'preparing-ai' |
          'summarizing' | 'finalizing' | 'done' |
          'cancelled' | 'error',
  level: number,
  completedUnits: number,
  totalUnits: number,
  totalCompletedUnits: number,
  startedAt: number | null,
  elapsedMs: number,
  abortController: AbortController | null,
  error: object | null
}
```

---

## 8. PDFテキスト抽出設計

### 8.1 読み込み

1. File APIでPDFを `ArrayBuffer` として取得する。
2. PDF.js `getDocument()` で開く。
3. 1ページ目から順に `getPage()` を実行する。
4. 各ページで `getTextContent()` を取得する。
5. `TextItem.str` を抽出する。

### 8.2 行の再構築

v0.1では高度な座標解析は行わない。

基本ルール:

- `TextItem.str` を順に追加
- `hasEOL === true` の場合は改行を入れる
- 同一行内のitem間は、文字列境界を見て必要な場合のみ空白を補う
- ページ末尾にはページ境界を示す改行を入れる

ページ番号等を自動推測して削除する処理はv0.1では行わない。誤削除による情報損失を避けるためである。

### 8.3 スキャンPDF判定

以下の場合は警告を出し、要約開始ボタンを無効化する。

- 全体抽出文字数が0
- ほぼすべてのページが空

以下の場合は警告のみ表示し、ユーザーが続行可能とする。

- ページ数に対して抽出文字数が極端に少ない
- 一部ページのみ空

---

## 9. テキスト正規化

v0.1では意味を変えにくい処理のみに限定する。

実施:

- `\r\n` / `\r` → `\n`
- NUL等の不要な制御文字を除去
- 行末の不要な空白を除去
- 連続する半角空白を必要最小限に整理
- 3個以上の連続改行を2個へ縮約
- 空ページ由来の過剰な区切りを整理

原則として実施しない:

- Unicode NFKCによる一括変換
- 全角・半角の強制統一
- ハイフネーション推定結合
- ヘッダー / フッター自動除去
- 見出し推定

これらは誤変換リスクがあるためPhase 2以降とする。

---

## 10. チャンク分割設計

### 10.1 基本原則

固定文字数だけで切らない。

分割境界の優先順位:

1. ページ境界
2. 空行（段落境界）
3. 文末 `。！？!?`
4. 改行
5. 最後の手段として文字数境界

### 10.2 入力Quotaベースの決定

Summarizerインスタンスの `inputQuota` と `measureInputUsage()` を利用し、実測ベースで安全に投入可能なチャンクを作る。

安全率:

```text
TARGET_USAGE_RATIO = 0.70
HARD_USAGE_RATIO   = 0.85
```

初期方針:

- 目標は `inputQuota × 0.70` 以下
- 0.70を超えた場合は直前の自然境界で確定
- どうしても巨大な1ブロックの場合は再分割
- 0.85を超えるチャンクは生成しない

安全率は実機テストで調整する。

### 10.3 overlap

v0.1では小さなオーバーラップを許容する。

初期値:

```text
CHUNK_OVERLAP_CHARS = 150
```

ただしページ境界・段落境界を優先し、機械的に150字を必ず重複させるわけではない。

目的は、チャンク境界直前の文脈が完全に切れることを防ぐことである。

---

## 11. 再帰要約アルゴリズム

### 11.1 概要

```text
PDF text
  ↓
Level 0 chunks
  ↓ summarize each
Level 1 summaries
  ↓ regroup by quota
Level 1 groups
  ↓ summarize each
Level 2 summaries
  ↓
...
  ↓
Top summaries fit finalizer
  ↓
Prompt API finalization
  ↓
350–450 char final summary
```

### 11.2 終了条件

「要約が1件になるまで」だけを終了条件にはしない。

以下のいずれかを満たした時点で再帰要約を終了し、finalizerへ進む。

1. 全上位要約を連結してもfinalizerへ安全に投入できる
2. 上位要約が1件になった

これにより不要な要約階層を1段増やして情報を落とすことを避ける。

### 11.3 擬似コード

```js
async function distill(documentText, signal) {
  const summarizer = await createSummarizer();

  let level = 0;
  let chunks = await chunkForSummarizer(documentText, summarizer);

  while (true) {
    const summaries = [];

    for (const chunk of chunks) {
      throwIfAborted(signal);
      summaries.push(await summarizeWithRetry(chunk, summarizer, signal));
      reportProgress();
    }

    if (await canFinalize(summaries)) {
      return await finalizeSummary(summaries, signal);
    }

    level += 1;
    chunks = await groupSummariesForNextLevel(summaries, summarizer, level);
  }
}
```

### 11.4 文書順序の保持

すべてのチャンク・要約は原文順を保持する。

上位グループ化時にも並べ替えを行わない。

これにより、背景→方法→結果→結論等の文書構造を可能な限り維持する。

---

## 12. Summarizer API呼び出し設計

### 12.1 セッション利用

同一設定のSummarizerインスタンスを逐次処理で再利用する。

v0.1では並列要約を行わない。

理由:

- 端末負荷を予測しやすい
- 進捗と中止制御が単純
- ローカルモデルの資源競合を避ける
- 失敗箇所の特定が容易

### 12.2 context

中間要約には短いcontextを付与する。

例:

```text
これは長い文書を段階的に要約する処理の一部です。
後続の統合要約に必要な主要事項、結果、結論、重要な固有名詞・数値をできるだけ保持してください。
```

APIがcontextを入力Quotaに含めることを前提に、`measureInputUsage()` 時も同等条件で測定する。

### 12.3 再試行

1単位あたり最大3 attempt（初回 + 再試行2回）。

```text
Attempt 1: 通常
Attempt 2: 同一入力で再試行
Attempt 3: 入力を約80%へ再分割して再試行
```

`QuotaExceededError` 相当の場合は、同一入力をそのまま再実行せず、チャンクを縮小する。

### 12.4 タイムアウト

API自体のAbortSignalに加えて、アプリ側で単位処理タイムアウトを設ける。

初期値:

```text
UNIT_TIMEOUT_MS = 180_000  // 3分
```

200ページ級では全体処理時間が長くなり得るため、全体タイムアウトは設けない。

---

## 13. 最終要約設計

### 13.1 Prompt API session

最終化専用のfresh sessionを作成する。

中間処理と会話履歴を共有しない。

想定:

```js
LanguageModel.create({
  expectedInputs: [
    { type: 'text', languages: ['ja', 'en'] }
  ],
  expectedOutputs: [
    { type: 'text', languages: ['ja'] }
  ]
})
```

### 13.2 最終プロンプト

概念上、以下を使用する。

```text
以下は一つの文書全体を段階的に圧縮した要約群です。

文書全体について、目的、対象、主な内容、主要な結果・結論が分かるように、
350～450字程度の自然な日本語で要約してください。
重要な固有名詞、数値、条件は必要に応じて保持してください。
原文にない情報を追加・推測しないでください。
前置き、見出し、箇条書き、文字数の説明は付けず、要約本文のみ出力してください。

---
{topLevelSummaries}
```

### 13.3 文字数検証

出力後、JavaScriptで `Array.from(text).length` 相当の文字数を計測する。

判定:

```text
350–450字: 成功
300–500字: 許容（再試行しない）
それ以外: 最大1回だけ長さ調整を再試行
```

生成AIに厳密な文字数保証は求めない。

再試行後も範囲外の場合は結果を表示し、実文字数も併記する。

---

## 14. 処理中止

Run単位で `AbortController` を1つ持つ。

ユーザーが「中止」を押した場合:

1. run-level controllerをabort
2. 現在のAI処理を中断
3. 後続ループを終了
4. AI session / summarizerを破棄可能な範囲で解放
5. statusを `cancelled` にする
6. 新しいPDFを投入可能な状態へ戻す

`AbortError` はユーザー操作による正常中止として扱い、赤色エラー表示にはしない。

---

## 15. 状態遷移

```text
IDLE
 ↓ PDF選択
EXTRACTING
 ↓
READY
 ↓ 要約開始
PREPARING_AI
 ↓
SUMMARIZING_LEVEL_N
 ↓ 必要なら次階層
SUMMARIZING_LEVEL_N+1
 ↓
FINALIZING
 ↓
DONE
```

任意の処理状態から:

```text
→ CANCELLED
→ ERROR
```

`ERROR` / `CANCELLED` から新しいPDF投入で `IDLE` 相当へ戻せる。

---

## 16. UI設計

### 16.1 画面構成

単一ページ構成。

```text
┌──────────────────────────────────────┐
│ nano-distill                         │
│ Local recursive PDF summarizer       │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        PDFをここにドロップ        │ │
│ │       またはファイルを選択        │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Document                             │
│ report.pdf                           │
│ 186 pages / 7.8 MB / 164,320 chars  │
│                                      │
│ Gemini Nano: Ready                   │
│                                      │
│ [ 要約を開始 ]                       │
│                                      │
│ ───────────────────────────────────  │
│ Level 1                              │
│ 18 / 43 chunks                       │
│ ███████████░░░░░ 42%                 │
│ 経過 03:24                           │
│                                      │
│ [ 中止 ]                             │
│                                      │
│ ───────────────────────────────────  │
│ Final summary                        │
│ ...                                  │
│                                      │
│ 408字                    [コピー]    │
└──────────────────────────────────────┘
```

### 16.2 UI方針

- AIチャット風UIにはしない
- 文書処理ツールとして簡潔にする
- 現在何をしているかが常に分かる
- 長時間処理でも「止まって見えない」ことを重視
- 不要なアニメーションは付けない
- 進捗はチャンク数ベースで明示する

### 16.3 進捗情報

表示:

- 現在のフェーズ
- 現在の階層
- `完了数 / 当該階層総数`
- 全体処理済みAI call数
- 経過時間
- 現在処理中のチャンク番号

全体パーセントは、最終的な階層数が事前確定しないため厳密値にしない。

必要なら「現在階層の進捗率」として表示する。

---

## 17. エラー設計

### 17.1 エラー分類

```text
FILE_TYPE_ERROR
PDF_LOAD_ERROR
PDF_TEXT_EMPTY
PDF_EXTRACT_ERROR
AI_API_UNSUPPORTED
AI_MODEL_UNAVAILABLE
AI_MODEL_DOWNLOAD_ERROR
AI_CREATE_ERROR
AI_QUOTA_ERROR
AI_TIMEOUT
AI_GENERATION_ERROR
FINALIZE_ERROR
ABORTED
UNKNOWN_ERROR
```

### 17.2 表示方針

ユーザー向けメッセージと開発者向け詳細を分ける。

例:

```text
表示:
「このチャンクの要約に失敗しました。」

詳細ログ:
{
  code: 'AI_GENERATION_ERROR',
  level: 1,
  chunkId: 'L1-C18',
  attempt: 3,
  errorName: '...'
}
```

v0.1では詳細ログをDevTools consoleにも出す。

---

## 18. 処理ログ

大規模文書の実機検証を容易にするため、内部では以下を記録する。

```js
{
  runId,
  fileName,
  pageCount,
  sourceCharacterCount,
  levels: [
    {
      level,
      inputCount,
      outputCount,
      calls: [
        {
          sourceId,
          inputCharacters,
          measuredUsage,
          outputCharacters,
          attempts,
          durationMs,
          status,
          error
        }
      ]
    }
  ],
  finalSummaryCharacters,
  totalDurationMs
}
```

v0.1では永続保存・ダウンロードUIは必須としないが、データ構造自体は最初から持つ。

将来、診断ログJSON出力を追加可能にする。

---

## 19. 性能・資源管理

### 19.1 逐次処理

AI callは1本ずつ実行する。

### 19.2 メモリ

以下は保持する:

- ページ別抽出テキスト
- 現在および必要な要約階層
- 診断情報

不要になった一時AI sessionは破棄する。

PDF.jsのページオブジェクトを全ページ分永続保持しない。

### 19.3 UIブロック防止

PDF抽出ループではページ処理の間にUI更新機会を設ける。

ただしPrompt API / Summarizer API自体はWeb Workerで使用できないため、AI処理はmain windowから呼び出す。

---

## 20. セキュリティ・プライバシー

### 20.1 原則

- PDFをアプリ独自のサーバーへアップロードしない
- クラウドLLM APIを呼ばない
- PDF本文をanalyticsへ送らない
- 中間要約も外部送信しない

### 20.2 外部リソース

v0.1ではPDF.jsもvendoringし、実行時CDN取得を避ける。

将来的に外部フォントやanalyticsを導入する場合も、文書内容を含む情報を送信しない。

---

## 21. テスト設計

### 21.1 PDF入力

- 正常な1ページPDF
- 10ページ程度
- 30～50ページ
- 100～200ページ
- 空白ページを含むPDF
- 一部テキスト抽出不能ページを含むPDF
- 完全スキャンPDF
- PDF以外のファイル
- 破損PDF

### 21.2 テキスト抽出

確認:

- ページ順が維持される
- 行順が大きく崩れない
- 抽出文字数が表示される
- 空ページが検出される

### 21.3 チャンク

確認:

- quotaを超えない
- 文途中の分割が必要最小限
- 原文順を維持
- 巨大段落でも停止しない
- overlapが異常に重複しない

### 21.4 再帰要約

確認:

- 1チャンク文書では不要な階層を作らない
- 複数チャンクを順次処理する
- 上位階層が必要に応じて増える
- 200ページ級でも固定2階層に制限されない
- 最終化可能になった時点で余分な再要約を行わない

### 21.5 中断・障害

- ユーザー中止
- AI call timeout
- QuotaExceeded相当
- 途中チャンク失敗→再試行成功
- 再試行上限到達
- モデル未ダウンロード
- AI API利用不可

### 21.6 最終要約

確認:

- 日本語
- 約400字
- 目的・対象・主要内容・結果/結論が含まれる
- 原文にない明白な事実を追加していない
- 文書前半だけ、または後半だけに極端に偏らない

---

## 22. 受入基準 v0.1

以下をすべて満たした場合、v0.1の実装を受入可能とする。

1. PDFをD&Dまたはファイル選択で読み込める。
2. PDF.jsでページ順にテキストを抽出できる。
3. スキャンPDF等、十分なテキストがないPDFを検出できる。
4. Summarizer APIの入力上限を考慮して自動分割できる。
5. 全チャンクを逐次要約できる。
6. 要約群が大きい場合、自動的に次の要約階層を作れる。
7. 階層数を固定せず、必要回数再帰処理できる。
8. 最終的にPrompt APIで日本語要約を生成できる。
9. 最終要約は原則300～500字の範囲に入り、350～450字を目標とする。
10. 進捗、階層、経過時間を確認できる。
11. 処理中に中止できる。
12. 単位処理失敗時に再試行できる。
13. 100～200ページ程度のテキストPDFで完走を確認する。
14. PDF本文をアプリ独自の外部サーバーへ送らない。

---

## 23. 実装順序

### Step 1: Skeleton

- 静的HTML/CSS/ES Modules
- UI基本状態
- PDF.js導入

### Step 2: PDF extraction

- D&D
- page text extraction
- document metadata
- scan PDF warning

### Step 3: Built-in AI capability

- Summarizer feature detection
- Prompt API feature detection
- availability / download progress
- cancellation foundation

### Step 4: Chunker

- paragraph / sentence aware splitting
- `measureInputUsage()`
- quota-aware sizing

### Step 5: One-level summarization

- sequential summarization
- progress
- retry / timeout

### Step 6: Recursive pipeline

- regroup summaries
- level generation
- termination condition

### Step 7: Finalizer

- Prompt API final pass
- character count validation
- one optional length retry

### Step 8: Hardening

- error handling
- cancellation
- diagnostic log
- 5 / 50 / 200-page real-device tests

---

## 24. 将来拡張との境界

v0.1の再帰要約エンジンを、後続機能から利用できる独立層として設計する。

将来想定:

```text
PDF
 ↓
Extracted Document
 ↓
Recursive Distillation Engine
 ├─ Summary 400 chars
 ├─ Summary 120 chars
 ├─ Controlled tags
 ├─ Free tags
 ├─ Project metadata
 └─ Search keywords
```

タグ生成や業務実績DB用構造化抽出を追加しても、PDF抽出・チャンク・再帰処理の基本部分を作り直さなくてよい構造を目指す。

---

## 25. 主要な設計判断

| 項目 | 決定 |
|---|---|
| アプリ形式 | 静的Webアプリ |
| 対象 | Desktop Chrome |
| PDF解析 | PDF.js |
| OCR | v0.1ではなし |
| 中間AI処理 | Summarizer API / Gemini Nano |
| 最終AI処理 | Prompt API / Gemini Nano |
| 長文方式 | recursive summary of summaries |
| 分割基準 | 自然境界 + input quota実測 |
| AI実行 | 逐次 |
| 最終要約 | 350～450字目標、300～500字許容 |
| 全体タイムアウト | なし |
| 単位タイムアウト | 3分（初期値） |
| リトライ | 初回 + 最大2回 |
| サーバー | 不要 |
| クラウドLLM | 使用しない |
| 永続保存 | v0.1ではなし |

---

## 26. 参考資料

- Chrome for Developers: Summarizer API  
  https://developer.chrome.com/docs/ai/summarizer-api
- Chrome for Developers: Scale client-side summarization in small context windows  
  https://developer.chrome.com/docs/ai/scale-summarization
- Chrome for Developers: Prompt API  
  https://developer.chrome.com/docs/ai/prompt-api
- Chrome for Developers: Built-in AI get started  
  https://developer.chrome.com/docs/ai/get-started
- PDF.js API  
  https://mozilla.github.io/pdf.js/api/

---

## 27. v0.1設計結論

初版は、PDF全文をGemini Nanoへ直接投入する方式ではなく、PDF.jsで抽出した原文を入力Quotaに応じて安全に分割し、Summarizer APIで局所要約を逐次生成する。

生成された要約がまだ大きければ、原文順を維持したまま再グループ化し、同じ処理を必要な回数だけ再帰的に繰り返す。

十分に圧縮された最上位要約群だけをfreshなPrompt API sessionへ渡し、約400字の最終要約に整える。

この構造により、文書ページ数に応じて要約階層を自動的に増減でき、200ページ級を固定2階層で無理に処理する問題を避ける。
