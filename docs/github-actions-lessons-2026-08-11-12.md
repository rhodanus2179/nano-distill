# GitHub Actions 障害分析と開発上の教訓（2026-08-11〜12）

## 1. 目的

2026年8月11日〜12日に `nano-distill` で発生した GitHub Actions の連続失敗について、直接原因と背景要因を整理し、今後の開発ルールとして残す。

結論として、今回の中心的な問題は **GitHub Actions 自体の不安定さではなく、CI に流す各コミットが単独では整合した状態になっていなかったこと** である。Actions はむしろ、途中状態の不整合を意図どおり検出していた。

## 2. 概要

対象期間の失敗した workflow run は次のとおり。

- 2026-08-11: 7 run
- 2026-08-12: 4 run
- 合計: 11 run

ただし、8月11日の4 run は同じ2コミットについて `push` と `pull_request` の双方で Static check が走ったもので、2 run 分は重複実行である。したがって、失敗表示の件数と独立した不具合の件数は一致しない。

今回確認できた主要な原因は5系統である。

1. PDF.js 配布ZIPの内部構造を固定的に仮定した
2. Actions が生成したコミットに workflow ファイルまで含めようとした
3. 一度だけ使う実装適用 workflow を通常の `push` トリガーのまま残した
4. 実装・設定変更と、それに対応するテスト更新を別コミットに分けた
5. 複数ファイルにまたがるリファクタリングを、途中では壊れている複数コミットとして連続 push した

## 3. 事象別の分析

### 3.1 PDF.js 配布ZIPの構造を固定的に仮定した

8月11日の `Apply v0.2 implementation` の最初の失敗では、`Apply v0.2 source archive` は成功したが、`Vendor official PDF.js 5.7.284` で失敗した。

当初の workflow は、展開先に `build/pdf.min.mjs` が存在し、同じ想定ルートから worker と LICENSE を取得できることを前提としていた。

直後の修正では次のように変更された。

- `pdf.min.mjs` がなければ `pdf.mjs` を探索する
- `pdf.worker.min.mjs` がなければ `pdf.worker.mjs` を探索する
- LICENSE も固定位置ではなく探索する

したがって、直接原因は **外部配布物の実際のディレクトリ構成・ファイル名を確認せず、workflow 側で固定的に仮定したこと** と判断できる。

#### 教訓

外部アーカイブをCIで取得するときは、URLとバージョンを固定するだけでは不十分である。

- 実アーカイブの内容を事前に確認する
- 必要なら探索処理を用いる
- 必須ファイルの存在を `test -n` / `test -s` 等で明示的に検証する
- checksum を検証する
- 外部配布物の構造に依存する処理は、通常のアプリコードと同様に壊れうるものとして扱う

### 3.2 Actions の自己更新コミットに workflow ファイルまで含めた

PDF.js の取得処理を直した次の run では、実装適用・PDF.js取得・`npm run verify` までは成功したが、`Commit implementation` で失敗した。

その直後の修正コミットは `fix: keep workflow files out of bot implementation commit` であり、bot がコミットする直前に次を実行するよう変更している。

```bash
git checkout HEAD -- .github/workflows/static-check.yml .github/workflows/apply-v02.yml
```

この経緯から、直接的な問題は **Actions が生成・pushする実装コミットに `.github/workflows/` の変更まで含めようとしたこと** にあったと判断できる。

なお、当該 job の全文ログは後から取得できなかったため、GitHub が返した最終的なエラー文そのものまでは復元できていない。ただし、失敗ステップと直後の修正内容は一致している。

#### 教訓

CI は原則として **検証する側** に寄せ、同じブランチを自ら変更して push する設計は避ける。

特に、次の組合せは複雑性が急増する。

- `push` を契機に起動する
- checkout したブランチを書き換える
- workflow 自身を含むファイル群を変更する
- 同じブランチへ bot が再 push する

実装を自動適用する必要がある場合でも、通常CIとは分離し、`workflow_dispatch` 等の明示的な一回実行にするか、通常の開発ブランチ上で人または開発エージェントが完成したコミットを作成する方が安全である。

### 3.3 一回限りの適用 workflow が、その後の push でも再実行された

最終的に `github-actions[bot]` は `implement v0.2 recursive summarization and diagnostics` というコミットを作成し、そのコミットでは `.v02-patch/part01` 等の一時入力を削除した。

ところが `Apply v0.2 implementation` は引き続き `agent/implement-v0.2` への通常の `push` をトリガーとしていた。

そのため、その後の `ci: verify v0.2 tests and vendored PDF.js` という通常コミットでも workflow が再実行され、今度は最初の `Apply v0.2 source archive` で失敗した。入力である `.v02-patch/part*` は既に前回のbotコミットで削除済みだったためである。

#### 教訓

「一度だけ消費する入力」を使う workflow を、恒久的な `push` workflow として残してはいけない。

一回限りの migration / bootstrap / patch 適用処理は、次のいずれかにする。

- `workflow_dispatch` にする
- 入力ファイルの存在を `if` / `paths` 等で起動条件にする
- 成功後に workflow 自体を削除・無効化する
- そもそもCIに実装適用をさせず、完成したGitコミットとして投入する

### 3.4 8月11日: 設定変更とテスト更新を別コミットにした

`f434710` (`tighten fidelity constraints for v0.2.1`) では、`src/config.js` のプロンプトと診断用テンプレートバージョンを更新した。

一方、その時点の `tests/core.mjs` は依然として次を期待していた。

- `recursivePromptTemplateVersion === 'recursive-v3'`
- `finalPromptTemplateVersion === 'final-v3'`

実装側はそれぞれ `recursive-v4`、`final-v4` に変わっていたため、Static check の `Verify JavaScript and unit tests` が失敗した。

さらに次の `ab63ede` (`preserve qualifiers during final compression`) は `src/ai.js` を追加変更したが、前コミットで壊れたテストをまだ直していなかったため、再び失敗した。

その後の `33a3bb1` (`test terminology and modality preservation`) でテストがまとめて更新された。

#### 教訓

**仕様・実装・テストは同じ論理変更に属するなら同じコミットで整合させる。**

特に次を変更するときは、同じコミットで参照先を全検索する。

- export される関数名
- config のプロパティ名
- テンプレートバージョン
- ログスキーマ
- UI表示名
- テストの固定期待値

「まず実装をpushし、次のコミットでテストを直す」は、CI運用下では意図的に赤いコミットを作る行為になる。

### 3.5 8月12日: 複数ファイルのリファクタリングを途中状態のまま連続 push した

8月12日の4連続失敗は、最も典型的な事例である。

変更の流れは概ね次のとおりだった。

1. `bd72767` — `use sentence-based final summary control`
   - `src/config.js` を文字数・圧縮率ベースから文数・段落数ベースへ変更
   - しかし `src/ai.js` と `tests/core.mjs` はまだ旧API・旧設定を参照
2. `bf69752` — `add final structure counters`
   - 関連処理を追加したが、リファクタリング全体はまだ未完
3. `3e097f3` — `replace percentage compression with sentence reduction`
   - `buildCompressionPrompt` を削除し、`buildSentenceReductionPrompt` に置換
   - `calculateCompressionRatio` も削除
   - しかしテストは旧関数を import したまま
4. `5bcc8b4` — `log final sentence and paragraph counts`
   - diagnostics 側を更新
   - テストはまだ旧APIのまま
5. `0cc774a` — `test sentence-based final control`
   - テストを新APIへ追従
   - Static check が成功

この途中、`tests/core.mjs` が

```js
import { buildCompressionPrompt, calculateCompressionRatio, classifyFinalLength } from '../src/ai.js';
```

を実行した時点で、`src/ai.js` から `buildCompressionPrompt` が既に削除されていたため、Node.js は次のエラーで停止した。

```text
SyntaxError: The requested module '../src/ai.js' does not provide an export named 'buildCompressionPrompt'
```

これは GitHub Actions の偶発的な障害ではなく、**リファクタリング途中の不整合なコミットをActionsが正しく検出した** ものである。

#### 教訓

複数ファイルにまたがる変更は、作業手順を複数段階に分けてもよいが、**pushする単位は常に green にする**。

特にAIエージェントやGitHub API経由で開発する場合、ファイルごとの連続コミットは避ける。関連ファイルをすべて編集した後、1つの tree / commit としてまとめてpushする。

## 4. なぜ失敗表示が多く見えたか

### 4.1 `push` と `pull_request` の二重実行

8月11日の Static check では、同一コミットに対し `push` と `pull_request` の双方でworkflowが走った例があった。

この構成では、feature branch にpushするたびに同じ検証が2回走り、1つの不具合が2件の赤いrunとして表示される。

#### 推奨

feature branch の検証をPR中心にするなら、たとえば次のように責務を分ける。

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

これにより、feature branch ではPR側だけ、`main` へ入った後はpush側だけが走る。

### 4.2 `node --check` だけではモジュール間整合性は検出できない

`npm run check` の `node --check` は、各JavaScriptファイル単体の構文を検証する。

そのため、次のような不整合は検出できない。

- import している named export が存在しない
- 呼び出し側が削除済みのAPIを参照している
- config のプロパティを削除したのに利用側が残っている

今回これらを検出したのは `npm test` である。

したがって、CIが `npm run check` だけでなく `npm run verify`（`check && test`）を実行する現在の方向性は正しい。

## 5. 共通する根本原因

今回の複数障害に共通する根本原因は、次の3点に整理できる。

### A. 「ファイル単位」で変更を積み、「整合した変更単位」でコミットしていなかった

AIやコネクタはファイルを1つずつ変更しやすい。しかしGitのコミット境界はファイル境界ではなく、**動作が一貫する論理変更の境界** に置く必要がある。

### B. CIを「完成後の検証」ではなく「作業途中の保存先」として使ってしまった

CIは壊れた途中状態を直してくれる仕組みではない。push時点で最低限のローカル検証または同等の検証を済ませ、CIは再現確認として使うべきである。

### C. 一時的な実装投入のために、自己書換え型workflowを導入して複雑性を増やした

アーカイブ分割 → Actionsで復元 → 外部依存を取得 → テスト → botが同じブランチへcommit/push、という流れは、通常の「完成したコミットをpushする」方法より状態数が多く、失敗点も多い。

一時的な制約回避としては成立しても、常用すべき開発経路ではない。

## 6. 今後の開発ルール

以下を `nano-distill` の開発ルールとする。

### P0: pushするすべてのコミットを green にする

原則として、push前に次を成功させる。

```bash
npm run verify
```

テストを意図的に先に壊すTDD的な作業を行う場合も、その赤い途中コミットを共有ブランチへpushしない。

### P0: 関連する実装・テスト・設定を同一コミットに含める

関数の rename / removal、config変更、ログスキーマ変更、プロンプトバージョン変更などは、それを参照するテスト・UI・診断処理まで同時に更新する。

### P0: CIが赤い状態で次の関連コミットを連打しない

最初の失敗が出たら、原則としてそこで原因を確認する。

「別ファイルの変更を続ければ最後には直る」方式は、途中の失敗runを大量に作り、最初に生じた本当の原因を見えにくくする。

### P1: AI / GitHubコネクタによる複数ファイル変更は1コミットにまとめる

GitHub API等でファイル単位の更新を逐次commitするのではなく、可能なら次の手順を使う。

1. 必要な変更ファイルを全て確定する
2. テストも同時に更新する
3. 完成状態を検証する
4. 1つのGit treeを作る
5. 1コミットとしてbranchへ反映する

大きな変更を複数コミットに分ける場合も、各コミット単独で `npm run verify` が成功する境界に分ける。

### P1: CIから同じブランチへcommit/pushしない

通常の Static check / test workflow は read-only とする。

自動生成・migration等で書込みが必要な処理は、通常CIとは別workflowにし、明示実行か専用ブランチを使う。

### P1: 一回限りのworkflowは恒久的な `push` トリガーにしない

入力を消費する処理、migration、bootstrap、vendoring等は、再実行可能性を設計したうえで起動条件を限定する。

### P1: 外部アーカイブの構造を推測しない

バージョン固定、checksum検証、必須ファイル検証を行い、配布物の実構造を確認する。

### P1: feature branch の CI 二重実行を避ける

同一内容に `push` と `pull_request` が二重に走らないようトリガーを整理する。

### P2: workflow警告も定期的に解消する

今回の失敗原因ではないが、Actions上では `actions/checkout@v4` のNode.jsランタイムに関する非推奨警告も確認された。失敗原因と混同せず、依存Actionの更新として別途処理する。

## 7. push前チェックリスト

開発者・AIエージェントとも、push前に最低限次を確認する。

- [ ] 変更した export / import の参照先を全て更新した
- [ ] 削除・renameした config key の参照が残っていない
- [ ] 実装変更に対応するテストを同じコミットに含めた
- [ ] バージョン・診断スキーマ・テンプレートバージョンの期待値を更新した
- [ ] `npm run verify` が成功した
- [ ] 外部ファイルを扱う場合、実際の構造・checksum・必須ファイルを確認した
- [ ] workflowが自分自身または同じbranchを書き換える設計になっていない
- [ ] 一回限りのworkflowが通常のpushで再発火しない
- [ ] 同じコミットに `push` / `pull_request` のCIが重複していない
- [ ] CIが赤い場合、次の変更を積む前に最初の失敗原因を確認した

## 8. AIエージェント向け追加原則

このリポジトリをAIエージェントで改修するときは、特に次を守る。

1. **「編集できた」ではなく「リポジトリ全体として整合した」を完了条件にする。**
2. 1つのリファクタリングを、`config.js`、`ai.js`、`diagnostics.js`、`tests` のようなファイル単位コミットに分割しない。
3. APIの削除・renameを行う前に、参照箇所を検索する。
4. テスト変更を「最後に追加する作業」と考えず、実装変更の一部として扱う。
5. GitHub Actionsをデバッグ用の逐次実行環境として使わない。
6. CIが失敗したら、失敗したrun・step・直前diffを確認してから修正する。
7. workaround用workflowを作る場合は、終了条件と撤去条件を最初から設計する。

## 9. 総括

今回の11件の失敗runは、GitHub Actionsの信頼性問題というより、**開発変更を細切れにpushしたことと、一時的な自己書換えworkflowを用いたことによって失敗件数が膨らんだ事例** である。

最も重要な改善はシンプルである。

> **CIに渡す最小単位を「1ファイル」や「1作業手順」ではなく、「単独で整合し、テストが通る1コミット」にする。**

この原則を守れば、今回の8月12日の4連続失敗や、8月11日のテスト追従遅れはほぼ防止できる。さらにCIをread-onlyに保ち、一回限りの自動適用処理を通常CIから分離すれば、8月11日前半のworkflow由来の失敗も大幅に減らせる。
