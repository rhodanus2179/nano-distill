# nano-distill v0.2.0 診断ログ設計

作成日: 2026-08-11

本書は `docs/design_v0.2.md` の「診断ログ拡張」を詳細化する補足設計である。

## 1. 目的

長大PDFの階層要約では、最終要約だけを見ても、どの段階で情報が消失・一般化・重複したかを判断しにくい。

v0.2.0では、各AI callの中間生成結果を診断ログとして保持し、以下を追跡できるようにする。

- どの原文チャンクから、どの中間要約が生成されたか
- 上位階層で、どの中間要約群がどの統合要約へ変換されたか
- 各段階でどの程度文字数が圧縮されたか
- どのcallに時間がかかったか
- retry / timeout / error がどこで発生したか
- Finalへ何件の中間要約が渡されたか
- Final生成後の相対圧縮で文章がどう変化したか

主な用途は実機検証・品質改善・不具合解析であり、通常利用者向けの履歴保存機能とは分離する。

---

## 2. プライバシー方針

診断ログには中間要約本文が含まれるため、元文書と同様に機密情報を含み得る。

そのため以下を必須とする。

1. 診断ログは実行中のJavaScriptメモリ上にのみ保持する。
2. Local Storage / Session Storage / IndexedDBへ自動保存しない。
3. サーバーや外部サービスへ自動送信しない。
4. ユーザーが明示的に「診断ログJSONを保存」を実行した場合のみ、ローカルファイルとして書き出す。
5. 「別のPDF」「ローカルデータを消去」「ページを閉じる」でメモリ上のログを破棄する。
6. ログ保存UIには「文書内容を含む可能性があります」と明示する。

`ローカルデータを消去` は現在のPDF・中間要約・最終要約とともに現在の診断ログ参照も破棄する。

---

## 3. ログレベル

v0.2.0では、既定の診断ログを `standard` とする。

### 3.1 standard

保存する:

- 実行メタデータ
- PDFメタデータ
- pipeline設定値snapshot
- 各階層の構造
- 各AI callの入力元ID
- 入力文字数 / measured usage
- **各中間生成結果の全文**
- 出力文字数
- attempt / duration / status / error
- Final生成結果の全文
- Final相対圧縮の各pass全文

保存しない:

- PDFバイナリ
- Level 1へ投入した原文チャンク全文

Level 1の入力元は、ページ範囲またはsource chunk IDで追跡できるようにする。

### 3.2 将来拡張: detailed

必要になった場合のみ、Level 1の原文チャンク全文も含む `detailed` モードを追加できる構造にする。

v0.2.0ではUIへ詳細ログ切替を追加しなくてもよい。

理由:

- 176,000字級ではログサイズが大きくなる。
- 原文全体を複製するため機密情報の重複保存になる。
- 中間生成の品質検証は、まず中間出力全文とsource metadataで十分に行える。

---

## 4. ログ構造

トップレベル概念:

```js
{
  logFormatVersion: '1.0',
  appVersion: '0.2.0',
  runId: '...',
  startedAt: '2026-08-11T07:00:00.000Z',
  endedAt: '2026-08-11T07:21:00.000Z',
  status: 'done',

  document: { ... },
  config: { ... },
  extraction: { ... },
  levels: [ ... ],
  finalization: { ... },
  totals: { ... }
}
```

---

## 5. document / extraction

```js
{
  document: {
    fileName: 'report.pdf',
    fileSize: 12478000,
    pageCount: 195,
    characterCount: 176077,
    emptyPageCount: 2
  },

  extraction: {
    extractedPageCount: 193,
    emptyPageNumbers: [12, 195],
    warning: null
  }
}
```

ファイルのローカルパスは取得・保存しない。

---

## 6. config snapshot

実行時の設定をそのまま保存する。

例:

```js
{
  initialChunkChars: 6000,
  chunkOverlapChars: 180,
  quotaSafetyRatio: 0.72,
  maxSummariesPerGroup: 5,
  maxFinalSourceItems: 8,
  finalTargetChars: 400,
  finalNormalMinChars: 300,
  finalNormalMaxChars: 550,
  maxCompressionPasses: 2,
  maxRetries: 2,
  unitTimeoutMs: 180000
}
```

実機結果を異なる設定値間で比較できるようにする。

---

## 7. Level 1 中間生成ログ

各原文チャンク要約について以下を保存する。

```js
{
  callId: 'L1-C001',
  phase: 'intermediate',
  level: 1,
  order: 1,

  source: {
    type: 'document-chunk',
    sourceIds: ['C001'],
    pageStart: 1,
    pageEnd: 6
  },

  input: {
    characters: 5832,
    measuredUsage: 2140,
    inputQuota: 4096
  },

  output: {
    text: '...',
    characters: 612
  },

  attempts: [
    {
      attempt: 1,
      status: 'success',
      durationMs: 31240,
      error: null
    }
  ],

  durationMs: 31240,
  status: 'success'
}
```

`output.text` が中間生成結果そのものとなる。

---

## 8. 上位階層の統合ログ

Level 2以降では、入力元となった中間要約IDを必ず保存する。

例:

```js
{
  callId: 'L2-G001',
  phase: 'recursive-summary',
  level: 2,
  order: 1,

  source: {
    type: 'summary-group',
    sourceIds: [
      'L1-C001',
      'L1-C002',
      'L1-C003',
      'L1-C004',
      'L1-C005'
    ]
  },

  input: {
    itemCount: 5,
    characters: 2910,
    measuredUsage: 1320,
    inputQuota: 4096
  },

  output: {
    text: '...',
    characters: 598
  },

  attempts: [ ... ],
  durationMs: 28700,
  status: 'success'
}
```

これによりログ単体で要約ツリーの親子関係を復元できる。

---

## 9. passthrough

singleton groupなど、AI callを行わず次階層へ渡した要約もログへ記録する。

```js
{
  nodeId: 'L2-P001',
  phase: 'passthrough',
  level: 2,
  sourceIds: ['L1-C031'],
  output: {
    text: '...',
    characters: 570
  },
  aiCall: false
}
```

AI call数と階層output数の差を説明できるようにする。

---

## 10. level summary

各階層について集計値を保存する。

```js
{
  level: 2,
  inputCount: 34,
  groupCount: 7,
  aiCallCount: 7,
  passthroughCount: 0,
  outputCount: 7,
  inputCharactersTotal: 20340,
  outputCharactersTotal: 4170,
  durationMs: 205000,
  nodes: [ ... ]
}
```

圧縮率もJSで算出可能とする。

```js
compressionRatio = outputCharactersTotal / inputCharactersTotal;
```

---

## 11. Final生成ログ

Finalへ渡した中間要約のIDと全文を追跡できるようにする。

```js
{
  finalization: {
    sourceIds: [
      'L2-G001',
      'L2-G002',
      'L2-G003',
      'L2-G004',
      'L2-G005',
      'L2-G006',
      'L2-G007'
    ],
    sourceCount: 7,
    sourceCharacters: 4170,

    passes: [
      {
        pass: 0,
        type: 'final-generation',
        outputText: '...',
        outputCharacters: 731,
        requestedRatio: null,
        durationMs: 42000,
        status: 'success'
      },
      {
        pass: 1,
        type: 'relative-compression',
        inputCharacters: 731,
        requestedRatio: 0.55,
        outputText: '...',
        outputCharacters: 428,
        durationMs: 25000,
        status: 'success'
      }
    ],

    finalText: '...',
    finalCharacters: 428,
    lengthStatus: 'normal'
  }
}
```

初回Finalと圧縮後の文章を比較できるよう、各passの全文を残す。

---

## 12. failed / timeout / cancelled attempt

成功したcallだけでなく、失敗したattemptも保存する。

```js
{
  attempt: 1,
  status: 'timeout',
  durationMs: 180012,
  error: {
    name: 'TimeoutError',
    message: '処理がタイムアウトしました。'
  }
}
```

再試行成功した場合も、最初の失敗attemptを削除しない。

実行全体がerror / cancelledになった場合も、その時点までのpartial logをユーザーが保存できるようにする。

これは長大PDFの検証で特に重要である。

---

## 13. totals

```js
{
  totals: {
    aiCallsStarted: 42,
    aiCallsSucceeded: 41,
    aiCallsFailed: 1,
    retries: 1,
    timeouts: 1,
    recursionLevels: 2,
    initialChunkCount: 34,
    totalDurationMs: 1259000
  }
}
```

---

## 14. prompt / contextの記録

全文プロンプトを毎call重複保存するとログが肥大化するため、テンプレートにはIDを付ける。

例:

```js
{
  promptTemplateVersion: 'intermediate-v2',
  contextTemplateVersion: 'recursive-v2'
}
```

実際に動的生成した短いcontext（例: `第1層 3/34`）は必要に応じて保存する。

固定system prompt全文はログに毎回複製せず、アプリバージョンとtemplate versionから追跡する。

---

## 15. UI

結果画面または処理画面に以下を追加する。

```text
[ 診断ログJSONを保存 ]
```

完了時だけでなく、error / cancelled状態でも、ログが1件以上存在すれば有効にする。

ボタン付近へ以下を表示する。

```text
※ 診断ログには中間要約など文書内容が含まれます。
```

通常利用ではログ内容を画面へ大量表示しない。

---

## 16. ファイル名

```text
nano-distill-debug-2026-08-11T07-21-00-000Z.json
```

ISO日時をベースとし、Windowsで使用しにくい `:` は `-` に変換する。

元PDF名はログ内部に保存するが、診断ログファイル名へは原則含めない。

理由:

- 極端に長いファイル名を避ける。
- ファイル名だけで案件名等が露出することを減らす。

---

## 17. 実装構成案

新規:

```text
src/
└─ diagnostics.js
```

主な責務:

```js
createRunLog()
recordExtraction()
startAiCall()
finishAiCall()
recordAttempt()
recordPassthrough()
recordLevelSummary()
recordFinalPass()
finishRun()
exportRunLogJson()
clearRunLog()
```

`pipeline.js` 自身へ巨大なログ構築処理を埋め込まず、診断処理を分離する。

---

## 18. メモリ上限への配慮

標準ログでは原文チャンク全文を複製しないため、主な追加メモリは中間要約全文となる。

195ページ・34チャンク程度では、原文176,077字に対して中間要約は数万字以下と想定され、実用上は許容しやすい。

ただし将来detailedログを追加する場合は、原文複製によるメモリ増加を考慮する。

---

## 19. 受入基準

1. Level 1の各中間生成結果全文がログへ残る。
2. Level 2以降の各統合要約全文がログへ残る。
3. 各上位要約から入力元summary IDを逆引きできる。
4. passthroughも階層構造上のnodeとして記録される。
5. Final初回生成と相対圧縮各passの全文が残る。
6. attemptごとに成功・error・timeout・durationが残る。
7. error / cancelled runでもpartial logを保存できる。
8. ログは自動で永続保存されない。
9. ログは外部サービスへ送信されない。
10. ユーザー操作でJSONとしてローカル保存できる。
11. 「ローカルデータを消去」でメモリ上の診断ログも破棄される。
12. 診断ログ保存UIに文書内容を含む旨を表示する。

---

## 20. 設計判断

中間生成結果のログは、単なるデバッグ情報ではなく、階層要約の品質を検証するための重要な観測データと位置付ける。

特に今後、fan-in値、チャンクサイズ、Summarizerの設定、Finalプロンプトを調整する際には、最終要約だけでなく各階層の生成結果を比較する必要がある。

一方で、ログ自体が文書内容を含むため、通常のアプリデータとは異なり、**明示的なユーザー操作がない限り永続化しない**ことを原則とする。