# nano-distill 改修設計書 v0.2.0

作成日: 2026-08-11

## 1. 改修目的

v0.1.0 の実機テストでは、195ページ・176,077字のPDFを34初期チャンクへ分割し、34件の第1層要約を生成した後、その34件がPrompt APIのコンテキストに収まったため、第2層を作らず直接最終要約を生成した。

処理自体は約21分で完走し、長大PDFをローカルで再帰要約する基本方式が機能することを確認できた。一方、最終要約は731字となり、目標としていた約400字より長く、不自然な英単語混入や重複・一般論化も一部見られた。

v0.2.0では、以下を主目的とする。

1. 「コンテキストに入るか」だけでなく「一度に統合させる情報量」を制御する。
2. Gemini Nanoに日本語の厳密な文字数計数を要求しない。
3. 文字数判定はJavaScriptで決定論的に行い、長すぎる場合のみ相対的な圧縮をNanoへ依頼する。
4. 文中での機械的切断は行わず、意味単位を保持したまま短縮する。
5. PDF.jsの実行時CDN依存を除去し、ローカル処理という設計意図をより明確にする。

---

## 2. v0.1.0 実機結果から得られた知見

### 2.1 実機結果

- PDF: 195ページ
- ファイルサイズ: 11.9 MB
- 抽出文字数: 176,077字
- 空ページ: 2ページ
- 初期チャンク: 34件
- 第1層: 34 → 34
- AI call: 35回
- 処理時間: 20分59秒
- 最終要約: 731字

### 2.2 良かった点

- 195ページ級でも処理が停止せず完走した。
- PDF.jsの抽出、チャンク分割、逐次要約、最終統合が一連で動作した。
- 34件の中間要約をPrompt APIが受け取れることを確認できた。
- ローカルGemini Nanoだけで長文PDFの要約が現実的な時間で実行できた。

### 2.3 課題

#### A. Finalへ渡す要約数が多すぎる

現行処理は以下を終了条件としている。

```text
全上位要約がFinal Promptのコンテキストに安全に入る
```

このため、34件の局所要約がコンテキストに収まる場合、34件すべての重要度比較・重複整理・全体統合を最後の1 callへ委ねる。

コンテキスト容量上は可能でも、小型ローカルモデルに対する統合作業としては負荷が大きい。

#### B. 日本語文字数をNanoへ直接要求している

現行は350〜450字という文字数指定をPrompt APIへ行い、範囲外なら1回だけ再調整している。

LLMは文字単位ではなくトークンを基礎として生成するため、日本語の厳密な文字数調整を主責務にする設計は避ける。

#### C. 再調整後の長さを再評価していない

現行は再調整後の出力が再び長すぎても、そのまま採用する。

#### D. PDF.jsのコード取得に外部通信が残る

文書データ自体は外部送信していないが、v0.1.0ではPDF.js本体をjsDelivrから取得している。

機密文書を扱うローカルツールとして、アプリ依存コードもリポジトリ内へ固定する方が説明しやすい。

---

## 3. 改修範囲

### 3.1 v0.2.0で実装するもの

- Final直前の要約件数上限
- 再帰統合1回あたりのfan-in上限
- 件数上限とinput quotaの双方を考慮したグループ生成
- 最終要約のJS文字数評価
- 長すぎる最終要約への比率指定再圧縮
- 最大2回の再圧縮
- 短すぎる要約を自動的に水増ししない方針
- 長さ調整履歴・最終入力件数の診断表示/ログ
- Finalプロンプトの自然な日本語重視への修正
- PDF.jsのvendoring
- CSPの外部CDN許可削除
- バージョンを0.2.0へ更新

### 3.2 v0.2.0では実装しないもの

- タグ生成
- DB連携
- OCR
- 見出し/章構造解析
- 文書内容のファクトチェック
- 自由な要約文字数設定UI
- Rewriter APIへの依存
- クラウドLLMフォールバック

Rewriter APIには`length: "shorter"`があるが、v0.2.0では新しい実験的API依存を増やさず、現在すでに利用しているSummarizer APIとPrompt APIの範囲で改善する。

---

## 4. 改修後の処理フロー

```text
PDF
 ↓
PDF.js text extraction
 ↓
初期チャンク生成
 ↓
Summarizer API
 ↓
Level 1 summaries
 ↓
┌─────────────────────────────────────┐
│ Final条件                           │
│ 1. 件数 <= MAX_FINAL_SOURCE_ITEMS   │
│ 2. Prompt API contextに安全に入る   │
└─────────────────────────────────────┘
 ↓ No
件数 + quota制約でグループ化
 ↓
Summarizer APIで上位要約
 ↓
必要回数反復
 ↓ Yes
Prompt APIで最終要約
 ↓
JSで文字数計測
 ↓
長すぎる？ ─ No → 採用
 ↓ Yes
圧縮率をJSで計算
 ↓
Prompt APIへ「約XX%に圧縮」
 ↓
JSで再計測
 ↓
最大2回まで反復
 ↓
採用 + 長さステータス表示
```

---

## 5. 再帰要約の終了条件変更

### 5.1 現行

```js
while (!(await canFitFinalPrompt(session, summaries.join('\n\n')))) {
  // 上位要約を作る
}
```

### 5.2 v0.2.0

```js
while (!(await canFinalize(session, summaries))) {
  // 上位要約を作る
}
```

概念上の判定:

```js
async function canFinalize(session, summaries) {
  if (summaries.length > MAX_FINAL_SOURCE_ITEMS) return false;
  return canFitFinalPrompt(session, summaries.join('\n\n'));
}
```

### 5.3 初期値

```text
MAX_FINAL_SOURCE_ITEMS = 8
```

理由:

- 34件を1 callで直接統合する状況を避ける。
- 小規模文書は不要な中間層を増やさない。
- 8件以下でもコンテキストが大きければ、従来どおり追加圧縮する。

例:

```text
4 summaries
→ Final

34 summaries
→ 7 summaries
→ Final

150 summaries
→ 30 summaries
→ 6 summaries
→ Final
```

実際の件数はquotaによって前後する。

---

## 6. 再帰統合時のfan-in制御

### 6.1 問題

現行の`groupSummariesForQuota()`は、quotaに入る限り多数の要約を1グループへまとめることができる。

仮に34件すべてがSummarizer APIのquotaへ収まれば、34 → 1の極端な圧縮も起こり得る。

### 6.2 改修

1グループへ含める要約数にも上限を設ける。

```text
MAX_SUMMARIES_PER_GROUP = 5
```

グループ確定条件は以下のORとする。

1. 5件に達した
2. 次の要約を追加するとsafe quotaを超える

### 6.3 例

34件の場合:

```text
[1–5]
[6–10]
[11–15]
[16–20]
[21–25]
[26–30]
[31–34]

34 → 7
```

31件の場合、最後の1件だけになったグループは原則として再要約せずpass-throughとする。

```text
31 inputs
→ 6 summarized groups + 1 passthrough
→ 7 outputs
```

目的:

- 1件だけを再要約して情報を失うことを避ける。
- 不要なAI callを減らす。

---

## 7. 最終要約の長さ制御

## 7.1 基本方針

Nanoに「厳密に400字」と数えさせない。

役割を以下のように分ける。

### JavaScript

- Unicode文字数を計測
- 長さステータスを判定
- 必要な圧縮率を計算
- 再圧縮回数を管理

### Gemini Nano

- 内容の重要度判断
- 重複・一般論の削除
- 意味を保持した文章圧縮
- 自然な日本語への統合

---

## 7.2 長さ設定

初期値:

```text
FINAL_TARGET_CHARS = 400
FINAL_NORMAL_MIN   = 300
FINAL_NORMAL_MAX   = 550
MAX_COMPRESSION_PASSES = 2
```

「400字」は目標値であり、合否の厳密な境界にはしない。

### ステータス

```text
300–550字  → normal
300字未満  → short
550字超    → long
```

`short`は自動的に長文化しない。

理由:

- 短い文書では300字未満でも十分な場合がある。
- 長文化のためだけの再生成は、冗長化や推測追加のリスクがある。

---

## 7.3 初回Finalプロンプト

厳密な文字数要求を弱める。

概念:

```text
以下は一つの文書全体を段階的に圧縮した要約群です。

文書の目的、対象、主な実施・検討内容、主要な結果・結論が分かるように、
簡潔な一段落の日本語概要として統合してください。
重要な固有名詞、数値、条件は必要に応じて保持してください。
重複した説明や一般論は削ってください。
技術用語・固有名詞を除き、不自然な外国語表現を混在させないでください。
入力にない事実を追加・推測しないでください。
見出しや箇条書きは不要です。
400字前後は目安であり、厳密に文字数を数える必要はありません。
```

文字数精度ではなく、情報密度と自然さを優先する。

---

## 7.4 長すぎる場合の相対圧縮

初回出力が550字を超えた場合のみ再圧縮する。

JSで以下を計算する。

```js
rawRatio = FINAL_TARGET_CHARS / currentLength;
ratio = clamp(rawRatio, 0.45, 0.85);
percent = Math.round(ratio * 100);
```

例:

```text
731字 → 400 / 731 = 0.547 → 約55%
600字 → 400 / 600 = 0.667 → 約67%
1000字 → 0.40 → clamp → 約45%
```

Nanoへの指示例:

```text
直前の要約を、およそ55%の長さに圧縮してください。
目的、主要な実施内容、重要な結果・結論、重要な固有名詞・数値は保持してください。
重複、細かな例示、一般論を優先して削除してください。
日本語として自然な一段落にし、要約本文だけを返してください。
```

「現在731字なので400字にしてください」とは指示しない。

---

## 7.5 再圧縮後の判定

```text
初回Final
 ↓
<= 550 → 採用
> 550  → compression pass 1
             ↓
          <= 550 → 採用
          > 550  → compression pass 2
                         ↓
                      採用
```

2回目後も550字を超える場合:

- 機械的に切断しない。
- 生成結果をそのまま表示する。
- UIで「目安より長め」と表示する。
- 診断ログへ`lengthStatus: "long"`を残す。

---

## 8. Final sessionの扱い

Final用Prompt API sessionはv0.1.0と同様、処理開始時に作成する。

初回Finalと相対圧縮は同一Final session内の短い会話として処理する。

最大でも以下の3 callとする。

```text
Final generation
Compression 1
Compression 2
```

長時間会話用途ではないため、v0.2.0ではsession compactingは導入しない。

ただしFinal投入前には従来どおり`measureContextUsage()` / `contextWindow`を利用して、安全に収まることを確認する。

---

## 9. UI改修

### 9.1 階層表示

195ページの実機例では、改修後は概ね以下の表示を想定する。

```text
第1層 34 → 34
第2層 34 → 7
最終要約 7件を統合
```

### 9.2 長さ調整表示

必要な場合のみ表示する。

```text
最終要約 731字
→ 約55%へ再圧縮
→ 428字
```

通常範囲なら最終的には簡潔に表示する。

```text
428字 / 目標 約400字
```

### 9.3 長さ警告

```text
short: 「短めの要約です」
long:  「目安より長めの要約です」
```

警告は品質エラーではなく参考表示とする。

---

## 10. 診断ログ拡張

Run resultへ以下を追加する。

```js
{
  finalSourceCount: 7,
  finalSourceCharacters: 4200,
  finalLength: {
    target: 400,
    normalMin: 300,
    normalMax: 550,
    initialCharacters: 731,
    finalCharacters: 428,
    status: 'normal',
    compressionPasses: 1,
    history: [
      { pass: 0, characters: 731 },
      { pass: 1, characters: 428, requestedRatio: 0.55 }
    ]
  }
}
```

各再帰レベルについても、可能であれば以下を保持する。

```js
{
  level: 2,
  inputCount: 34,
  groupCount: 7,
  aiCallCount: 7,
  passthroughCount: 0,
  outputCount: 7
}
```

実機検証時に「なぜこの階層数になったか」を追跡しやすくする。

---

## 11. PDF.jsのローカル化

### 11.1 方針

現在使用している固定バージョンのPDF.jsをリポジトリ内へ配置する。

想定:

```text
vendor/
└─ pdfjs/
   ├─ pdf.mjs
   ├─ pdf.worker.mjs
   └─ LICENSE
```

`src/config.js`:

```js
export const PDFJS_MODULE_URL = './vendor/pdfjs/pdf.mjs';
export const PDFJS_WORKER_URL = './vendor/pdfjs/pdf.worker.mjs';
```

### 11.2 CSP

CDNが不要になるため、CSPからjsDelivrを除外する。

概念:

```text
default-src 'self';
script-src 'self';
worker-src 'self' blob:;
connect-src 'self';
style-src 'self';
img-src 'self' data:;
```

### 11.3 プライバシー表示

UIの説明を以下へ変更する。

旧:

```text
PDF.jsのプログラム本体は固定バージョンをCDNから読み込みます…
```

新:

```text
PDF解析とAI要約はブラウザ内で実行します。
アプリは文書内容を外部サービスへ送信しません。
```

Chrome管理のGemini Nanoモデル自体は引き続きサイト保存領域とは別管理であることを明示する。

---

## 12. 設定値案

`src/config.js`に以下を追加・変更する。

```js
export const APP_VERSION = '0.2.0';

export const PIPELINE_CONFIG = Object.freeze({
  initialChunkChars: 6000,
  chunkOverlapChars: 180,
  quotaSafetyRatio: 0.72,
  finalContextSafetyRatio: 0.80,

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
```

実機結果を見て調整可能な設定として集約する。

---

## 13. 主なコード変更箇所

### `src/pipeline.js`

- `canFitFinalPrompt()`だけを終了条件にしない。
- `canFinalize()`を追加。
- `groupSummariesForQuota()`を件数上限対応へ変更。
- singleton groupのpass-through対応。
- `finalSourceCount`等の診断値を返す。

### `src/ai.js`

- Final promptから厳密文字数要求を弱める。
- `generateFinalSummary()`を複数段階の長さ評価へ変更。
- 相対圧縮率を受け取る`compressFinalSummary()`相当を追加。
- 各passの文字数履歴を返す。

### `src/config.js`

- fan-in上限設定
- final正常範囲設定
- 相対圧縮設定
- v0.2.0へ更新

### `src/ui.js`

- Final投入件数表示
- 長さ調整履歴表示
- short / longステータス表示

### `src/pdf.js`

- PDF.js import先をローカルvendorへ変更

### `index.html`

- CSPからCDN許可を削除
- プライバシー説明更新

### `docs/privacy.md`

- PDF.js CDN依存記述を削除
- v0.2.0の完全ローカル依存構成へ更新

---

## 14. テスト設計

### 14.1 再帰条件

#### Case A: 4件

```text
4 summaries + context fits
→ 中間層なし
→ Final
```

#### Case B: 34件

```text
34 summaries + context fits
→ 件数上限8を超えるため中間層生成
→ 34 → 約7
→ Final
```

#### Case C: 8件だがcontext超過

```text
8 summaries
→ 件数条件OK
→ context条件NG
→ 中間層生成
```

#### Case D: 150件

```text
150 → 約30 → 約6 → Final
```

固定階層ではなく、件数とquotaの双方で決まることを確認する。

---

## 14.2 fan-in

確認:

- 1グループ5件を超えない。
- quotaを超えない。
- 文書順序が維持される。
- 最後のsingletonを不要に要約しない。

---

## 14.3 長さ調整

### 731字

```text
731字
→ requested ratio 約55%
→ 再圧縮
```

### 600字

```text
600字
→ requested ratio 約67%
```

### 480字

```text
normal
→ 再圧縮なし
```

### 260字

```text
short
→ 自動長文化なし
```

### 900字 → 650字 → 570字

```text
2回再圧縮後もlong
→ 570字を表示
→ 機械的切断なし
→ long表示
```

---

## 14.4 回帰テスト

- D&D
- PDF抽出
- スキャンPDF警告
- AI availability
- モデル初回ダウンロード
- 中止
- タイムアウト
- retry
- ローカルデータ消去
- 最終要約コピー

v0.1.0で確認済みの基本機能を壊さない。

---

## 14.5 ローカル性

PDF.js vendoring後、DevTools Networkで以下を確認する。

- PDF解析時にjsDelivrへのrequestがない。
- 文書内容を含むrequestが外部originへ発生しない。
- Gemini Nanoモデルが準備済みの環境では、アプリ独自の外部AI API requestがない。

「ローカルデータを消去」によるLocal Storage / Session Storage / IndexedDB / Cache Storage / Service Worker登録の消去も継続確認する。

---

## 15. 受入基準 v0.2.0

1. Finalへ直接渡す中間要約は原則8件以下である。
2. 再帰統合1 callの入力は原則5要約以下である。
3. input quota制約はv0.1.0同様に維持される。
4. 195ページ実機PDFで、34件を直接Finalへ送らず追加中間層が生成される。
5. 最終要約の文字数をJSで計測する。
6. 550字超の場合、文字数そのものではなく比率指定で自動再圧縮する。
7. 自動再圧縮は最大2回とする。
8. 300字未満を自動的に長文化しない。
9. 最終結果を文字位置で機械的に切断しない。
10. 再圧縮後も550字超の場合、結果を保持したまま長めであることを表示する。
11. PDF.jsをリポジトリ内から読み込み、実行時CDN依存をなくす。
12. 文書データを外部サービスへ送信しないv0.1.0のプライバシー方針を維持する。
13. v0.1.0のD&D、抽出、中止、retry、データ消去等が回帰しない。

---

## 16. 実装優先順位

### Step 1: 再帰終了条件

- `maxFinalSourceItems`
- `maxSummariesPerGroup`
- quota + 件数の複合グループ化
- singleton passthrough

### Step 2: Final長さ制御

- deterministic char count
- length status
- relative compression
- max 2 passes
- no hard truncation

### Step 3: UI / diagnostics

- final source count
- hierarchy display
- length history
- short / long indication

### Step 4: PDF.js vendoring

- vendor files
- import path変更
- CSP変更
- privacy doc更新

### Step 5: 実機検証

- 195ページの同一PDFで再試験
- 小規模PDFとの回帰比較

---

## 17. 設計結論

v0.2.0では、再帰要約の目的を単なる「コンテキスト上限回避」から「小型ローカルモデルが安定して統合できる情報量への段階的圧縮」へ拡張する。

そのため、Final条件を

```text
contextに入る
```

から

```text
contextに入る
AND
要約件数が十分少ない
```

へ変更する。

また、最終400字程度という要件については、Gemini Nanoへ日本語文字数の厳密な計数を求めない。JavaScriptが長さを決定論的に測定し、必要な場合だけ「現在の文章を約XX%へ圧縮」という意味的な短縮処理をNanoへ依頼する。

これにより、Nanoは得意な情報選択・統合・文章圧縮へ集中し、文字数管理はアプリ側が担当する。

加えてPDF.jsをローカルvendor化し、文書処理ツールとして外部依存をさらに減らす。