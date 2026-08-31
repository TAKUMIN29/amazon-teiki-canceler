# amazon-teiki-canceler

[紹介ページ](https://takumin29.github.io/amazon-teiki-canceler/)

Amazonの「定期おトク便」を、任意の商品またはすべての商品について
**一括で解約 (cancel)** できるツールです。

- **デスクトップアプリ（GUI）** — インストーラをダブルクリックするだけで使える。
  ターミナル操作は不要。
- **CLI** — ターミナルから `npm run manage` 等で操作する。

どちらも中身は同じロジック（Playwrightでログイン済みの実Chromeを操作する形）を
使っています。Amazonに定期おトク便を操作する公開APIは無いため、この方式で
実現しています。操作対象のDOM構造は[`config/selectors.json`](./config/selectors.json)
に外出ししてあるので、Amazon側の画面が変わってもロジック本体（`src/`）を直す
必要は基本的にありません。

> **動作確認について**: `config/selectors.json` は2026-08-30にclaude-in-chromeで
> 実際のamazon.co.jpにログインして確認したDOM構造をもとに作成しています。
> 同日、実アカウントで `list`（一覧抽出）と `manage`（`--dry-run`での到達確認、および
> 実際の解約1件）が成功することを確認済みです。
>
> **次回スキップ機能について**: 以前は商品の編集画面から「次の配達を中止する」で
> 1商品ずつスキップできましたが、2026-08-31に実アカウントで確認したところ
> Amazon側の画面構造が変わり、この導線自体が無くなっていました。今のAmazonは
> 画面上部の「今後のお届け日数」カードから**配送日単位でまとめて**スキップする
> 仕組み（同じ配送日の他の商品も巻き込む可能性がある）に変わっており、商品単位で
> 選ぶという本ツールの前提と食い違うため、**スキップ機能は廃止しました。**
> 解約 (cancel) は引き続き利用できます。

## デスクトップアプリ（GUI）を使う

ターミナルを使わずに使いたい方はこちら。

1. [Releases](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/latest) から
   `定期おトク便かんたん解約 Setup x.x.x.exe` をダウンロード
2. ダブルクリックしてインストール（Node.jsのインストールは不要）
3. アプリを起動し、「ログインする」ボタンから普段通りAmazonにログイン
4. 一覧から商品ごとに「何もしない / 解約する」を選んで実行

動作にはお使いのパソコンに**Google Chromeがインストールされている**必要があります。
「テスト実行」チェックボックス（既定でON）を付けたまま試すと、実際には解約
されずに導線だけ確認できます。

> `main`ブランチに変更が入るたびに自動ビルドされる開発版テストビルド
> （[dev-build](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/tag/dev-build)）
> もありますが、これは動作確認用のプレリリースです。通常の利用は上記の正式リリース
> （バージョン番号が付いたもの）をお使いください。

## できること（CLI）

以下はターミナルから使う場合のコマンドです。GUIアプリでは同等の操作がすべて
ボタンで行えます。

- `manage` — 一覧を見ながら、**商品ごとに**「何もしない/解約」を選び、まとめて実行
  （用意した中で最も直感的な使い方。基本はこれを使えばOK）
- `list` — 定期おトク便の一覧をターミナルに表示（商品名・次回お届け日・数量・価格など）
- `cancel` — 選んだ商品（または `--all` で全商品）の定期購入を解約（全商品を同じ操作にしたいとき）
- `--dry-run` — 最後の確定ボタンの手前まで実際に画面を操作して確認し、確定は押さない
- `cancel` は `--index` / `--filter` / 対話選択（チェックボックス）のいずれでも対象を選べる
- 実行結果は `logs/` に、失敗時の画面キャプチャは `out/` に自動保存

## 動作環境（CLI）

- Node.js 20以上
- Google Chrome（未インストールなら `npx playwright install chromium` で代替可）
- Windows / macOS / Linux

Windows（コマンドプロンプト、PowerShell）とmacOS/Linux（bash、zsh）のどちらでも、
以下のコマンドはそのまま同じ形で使えます。

GUIアプリ（Windows向けインストーラ）はNode.jsのインストールは不要で、
Google Chromeのみ必要です。

## セットアップ（CLI）

```bash
npm install
npm run login    # ブラウザが開くのでAmazonにログイン（初回のみ）
```

Google Chromeが入っていない場合は、先に `npx playwright install chromium` を
実行してください（Playwright同梱のChromiumで動きます）。

ログイン情報は `.profile/`（このリポジトリ配下の永続プロファイル）に保存されます。
2回目以降は `npm run login` を実行し直す必要はありません。

## 使い方（CLI）

### 商品ごとに解約するか選ぶ（`manage`）

```bash
npm run manage
```

一覧を表示したあと、商品を1件ずつ「何もしない / 解約する」の2択で選んでいきます。
選び終わると実行予定の一覧を表示して最終確認し、まとめて実行します。`--dry-run`
を付けると最後の確定ボタンの手前まで動作確認だけ行います（実際には解約しません）。

### 全商品に同じ操作をしたいとき（`cancel`）

まず `npm run list` で今の商品名・番号を確認してから、以下のように使います
（`--filter` に渡す文字列は、`list` の出力に実際に出てくる商品名の一部に
置き換えてください。例のままでは自分の商品名と一致せず0件になります）。

```bash
# 一覧表示（番号と商品名を確認する）
npm run list

# 対話的に選んで解約（チェックボックスで選択）
npm run start -- cancel

# 全商品を対象に、確定の手前まで動作確認（実際には解約しない）
npm run start -- cancel --all --dry-run

# 商品名で絞り込んで一括解約（例: listに「◯◯ ティッシュー 5箱」があれば--filter "ティッシュー"）
npm run start -- cancel --filter "<listで見た商品名の一部>" --all --yes
```

解約を2件以上まとめて実行する場合は、実行前に `CANCEL` という文字列の入力を
求める追加確認が入ります（`-y/--yes` で省略可）。

### 画面が変わって動かなくなったとき

```bash
npm run inspect
```

現在の画面のスクリーンショット・HTML・候補ボタン一覧を `out/` に保存します。
`config/selectors.json` の候補を追記するだけで直る設計です。手順の詳細は
`.claude/skills/fix-teiki-selectors/SKILL.md` にまとめてあります。

## テスト

ローカルに用意したダミーのAmazon風画面（`test/mock-amazon.js`）に対して
CLIのロジック（一覧抽出・編集モーダルの開閉・理由選択・確定・dry-run・
連続解約時の再同定など）を検証します。このモックは
claude-in-chromeで実際のamazon.co.jpを操作して確認した画面構造
（`div[data-edit-link]`によるモーダル起動、`data-edit-url`のクエリ文字列に
ASIN/購読IDが入っている、等）を再現したものですが、実際のAmazonそのものには
一切アクセスしません。

```bash
npm test
```

## GUIアプリの開発

```bash
npm run electron    # 開発モードで起動（.profile/ をCLIと共有）
npm run dist         # Windows向けインストーラをビルド（dist/ に出力）
```

`electron/`配下のUIは`src/`のロジックをそのまま再利用しており、CLI側と挙動が
分かれることはありません（詳細は`electron/orchestrator.js`を参照）。

## ディレクトリ構成

```
src/
  index.js      CLIエントリポイント（login/list/cancel/manage/inspect）
  browser.js    ブラウザ起動・ページ遷移・ログイン判定
  scrape.js     定期おトク便カードの検出とフィールド抽出
  actions.js    設定ファイルのステップ列を実行するエンジン
  locator.js    セレクタ仕様(JSON) → Playwright Locator への変換
  ui.js         ターミナルの一覧表示・選択・確認プロンプト
electron/
  main.cjs        Electronメインプロセス（IPC・ウィンドウ管理）
  preload.cjs      contextBridgeでレンダラーにAPIを公開
  orchestrator.js  src/のロジックをGUI向けに呼び出す層
  renderer/        画面（HTML/CSS/JS、フレームワーク無し）
config/
  selectors.json  Amazon画面のDOM依存部分をまとめた設定（要調整はここだけ）
test/
  mock-amazon.js  検証用のダミーAmazon画面
  run-tests.js    上記に対する回帰テスト
```

## 注意事項

- **解約 (cancel) は元に戻せません。** 再度利用するには登録し直しが必要です。
  まず `--dry-run` で導線を確認してから実行することを推奨します。
- ログイン情報はローカルの `.profile/` にのみ保存され、外部には送信されません。
  `.gitignore` 済みです。
- Amazonの利用規約の範囲内で、ご自身のアカウントの定期おトク便を管理する目的でのみ
  利用してください。
- 本ツールはAmazonの非公式な自動操作を行うものであり、利用規約違反とみなされ
  アカウントが停止・制限される可能性があります。本ツールの利用により生じた
  いかなる損害（アカウント停止を含む）についても、作成者は一切の責任を負いません。
  自己責任でご利用ください。
