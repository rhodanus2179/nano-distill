# nano-distill v0.2 診断ログ設計

## 1. 目的

再帰要約では、最終結果だけでは「どの段階で情報が消えたか」「どの段階で意味が変質したか」を追跡しにくい。診断ログは、各AI callの入力元と生成結果を親子関係付きで記録し、実機検証時に要約品質を追跡できるようにする。

## 2. 保存方針

- 実行中はブラウザのメモリ上にのみ保持する
- 自動でLocal StorageやIndexedDBへ保存しない
- ユーザーが「診断ログJSONを保存」を明示的に実行した場合のみ端末へ書き出す
- 中止・エラー時も、その時点までのpartial logを保存可能とする
- 標準ログではLevel 1の原文チャンク全文を複製しない

## 3. 記録対象

### 文書

- ファイル名
- ファイルサイズ
- ページ数
- 抽出文字数
- 空ページ数

### 初期チャンク

- chunk ID
- 順序
- pageStart / pageEnd
- 文字数

### 各AI call

- callId
- phase
- level
- order
- sourceIds
- page range（Level 1）
- itemCount
- input characters
- measured input usage
- input quota
- context
- output全文
- output characters
- attempt履歴
- duration
- status
- error

### Final

- sourceIds
- sourceCount
- sourceCharacters
- Final generation全文
- relative compression各pass全文
- requestedRatio
- 各pass文字数
- 最終文字数
- lengthStatus

## 4. 親子関係

例：

```text
C001 → L1-C001 ┐
C002 → L1-C002 ├→ L2-G001
C003 → L1-C003 ┤
C004 → L1-C004 ┤
C005 → L1-C005 ┘
```

JSONのsourceIdsだけで、どの要約がどの上位要約へ統合されたかを復元できる。

## 5. attempt

成功だけでなく、timeout、error、retryも記録する。

```json
{
  "attempt": 1,
  "status": "timeout",
  "durationMs": 180000,
  "error": {"name": "TimeoutError"}
}
```

retry後に成功しても、失敗attemptを削除しない。

## 6. prompt template version

要約品質の比較を可能にするため、実行ログにテンプレート世代を保存する。

v0.2初期：

```text
intermediate-v2
recursive-v2
final-v2
relative-compression-v1
```

195ページ実機検証後の忠実性改善版：

```text
intermediate-v2
recursive-v3
final-v3
relative-compression-v1
```

`recursive-v3` は複数入力要約のcoverageを強化し、各入力要約の主要論点を原則1点以上反映するよう求める。

`final-v3` は常体を原則としつつ、「課題・原因・実施事項・結果・今後の検討/提案」の種別を保持し、課題記述から入力にない推奨策を生成しないよう制約する。

これにより、同じPDFを再実行した場合に、ログからプロンプト世代を識別して比較できる。

## 7. 情報管理

診断ログには中間要約など文書由来の内容が含まれる。そのため、UI上でも保存ボタン付近に注意書きを表示する。

保存したJSONファイルは通常の文書ファイルと同じ情報管理対象として扱う必要がある。

「ローカルデータを消去」では、メモリ上のrun logも破棄する。

## 8. 標準ログと将来拡張

標準ログでは原文全文の二重保存を避ける。将来、原文と生成結果の詳細diffが必要になった場合のみ、明示的な詳細ログモードを追加し、原文チャンク全文を含められるようにする。