# 定期おトク便かんたん解約（amazon-teiki-canceler）

[紹介ページ](https://takumin29.github.io/amazon-teiki-canceler/) ・
[ダウンロード](#ダウンロード) ・ [機能](#機能) ・ [使い方](#使い方) ・ [ビルド方法](#ビルド方法)

Amazonの「定期おトク便」を、選んだ商品だけ、またはすべての商品について
**まとめて解約**できるツールです。

- **デスクトップアプリ（GUI）**：インストーラをダブルクリックするだけで使えます。
  ターミナルの操作は要りません。
- **CLI**：ターミナルで `npm run manage` などのコマンドを使って操作します。

---

## ダウンロード

| 種類 | リンク | 備考 |
| --- | --- | --- |
| **正式版（おすすめ）** | [最新リリース](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/latest) | `定期おトク便かんたん解約 Setup x.x.x.exe` をダウンロード |
| 開発版テストビルド | [dev-build](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/tag/dev-build) | `main` への変更のたびに自動でビルドされる動作確認用のプレリリース |

**動作環境**

- GUIアプリ：Windows、**Google Chrome**（Node.jsは要りません）
- CLI：Windows / macOS / Linux、Node.js 20以上、Google Chrome
  （Chromeが無い場合は `npx playwright install chromium` で代わりに使えます）

> インストーラにはコード署名が無いため、初回起動時にWindowsの
> 「WindowsによってPCが保護されました」が表示されることがあります。
> その場合は「詳細情報」→「実行」で起動できます。

---

## 機能

- **商品ごとに解約するか選べる**：一覧を見ながら、商品ごとに「何もしない / 解約する」を選び、まとめて実行します。
- **一括解約**：すべての商品、または商品名で絞り込んだ商品をまとめて解約できます（CLI）。
- **テスト実行（dry-run）**：最後の確定ボタンの手前まで実際の画面を操作して導線を確認し、確定は押しません。GUIでは既定でONです。
- **誤操作の防止**：実行前に最終確認があります。CLIで全件を解約するときは `CANCEL` の入力が必要です。
- **ログイン状態の保存**：Chromeでログインしたセッションをローカルに保存します。2回目以降はログインし直す必要がありません。
- **実行ログ**：実行結果を `logs/` に、失敗したときの画面キャプチャを `out/` に自動で保存します。
- **画面変更への対応のしやすさ**：Amazonの画面に依存する部分は [`config/selectors.json`](./config/selectors.json) にまとめてあるので、画面が変わってもこのファイルを直すだけで済みます。

> **次回スキップ機能について**：以前は商品ごとに「次の配達を中止する」が
> できましたが、2026-08-31にAmazon側の画面構造が変わり、配送日単位でまとめて
> スキップする仕組みになりました（同じ配送日の他の商品も巻き込む可能性があります）。
> 商品単位で選ぶという本ツールの前提と合わないため、**スキップ機能は廃止しました。**

---

## 使い方

### デスクトップアプリ（GUI）

1. [ダウンロード](#ダウンロード)したインストーラをダブルクリックしてインストールします。
2. アプリを起動し、「ログインする」ボタンから普段通りAmazonにログインします
   （2段階認証やCAPTCHAもそのまま画面で操作してください）。
3. 一覧から商品ごとに「何もしない / 解約する」を選びます。
4. 最初は「テスト実行（実際には解約されません）」をONのまま実行して、導線を確認します。
5. 問題がなければテスト実行をOFFにして、もう一度実行します。

アプリの操作中はブラウザの画面が表示されます。実行中はブラウザを手で操作しないでください。

### CLI

```bash
npm install
npm run login    # ブラウザが開くのでAmazonにログイン（初回だけ）
```

ログイン情報はリポジトリ内の `.profile/` に保存されます（`.gitignore` 済み）。

**商品ごとに選んで解約する（おすすめ）**

```bash
npm run manage                 # 一覧を見ながら商品ごとに選んで実行
npm run manage -- --dry-run    # 確定ボタンの手前まで確認するだけ
```

**一覧の表示・一括解約**

```bash
# 一覧を表示（番号と商品名を確認する）
npm run list

# 対話形式で選んで解約（チェックボックスで選ぶ）
npm run start -- cancel

# すべての商品を対象に、確定ボタンの手前まで確認（実際には解約しない）
npm run start -- cancel --all --dry-run

# 番号で指定して解約
npm run start -- cancel --index 1,3,5-7

# 商品名の一部で絞り込んで解約（listで表示された商品名の一部を指定）
npm run start -- cancel --filter "<商品名の一部>" --all --yes
```

| オプション | 内容 |
| --- | --- |
| `--dry-run` | 最後の確定ボタンの手前まで確認し、実行はしない |
| `--all` | すべての商品を対象にする |
| `--index <番号>` | 番号で指定する（例: `1,3,5-7`） |
| `--filter <文字列>` | 商品名に含まれる文字列で絞り込む |
| `-y, --yes` | 確認プロンプトを省略する |
| `--headless` | ブラウザを表示せずに実行する（CLIのみ。初回ログイン後に使うことを推奨） |

**画面が変わって動かなくなったとき**

```bash
npm run inspect
```

今の画面のスクリーンショット・HTML・ボタン候補の一覧を `out/` に保存します。
その内容をもとに `config/selectors.json` へ候補を追加すれば直せます。

---

## ビルド方法

### 必要なもの

- Node.js 20以上
- Windows（インストーラのビルドはWindows上での実行を前提にしています）

### 手順

```bash
git clone https://github.com/TAKUMIN29/amazon-teiki-canceler.git
cd amazon-teiki-canceler
npm install

npm run electron   # 開発モードでGUIを起動（ログイン情報は .profile/ をCLIと共有）
npm run dist       # Windows向けインストーラをビルド → dist/ に .exe を出力
```

### 自動ビルド（GitHub Actions）

- `main` にpushすると、開発版テストビルド（[dev-build](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/tag/dev-build)）が自動で更新されます。
- `v1.2.3` のようなタグをpushすると、正式版のGitHub Releaseが自動で作成されます。

```bash
npm version patch   # package.json のバージョンを上げてタグを作成
git push --follow-tags
```

### ディレクトリ構成

```
src/
  index.js      CLIのエントリポイント（login/list/cancel/manage/inspect）
  browser.js    ブラウザの起動・ページ遷移・ログイン判定
  scrape.js     定期おトク便カードの検出と各項目の抽出
  actions.js    設定ファイルに書いた手順を順に実行するエンジン
  locator.js    セレクタ設定(JSON)をPlaywrightのLocatorに変換
  ui.js         ターミナル上の一覧表示・選択・確認
electron/
  main.cjs         Electronのメインプロセス（IPC・ウィンドウ管理）
  preload.cjs      レンダラーに公開するAPI
  orchestrator.js  src/ のロジックをGUIから呼ぶための層
  renderer/        画面（HTML/CSS/JS、フレームワークは不使用）
config/
  selectors.json   Amazon画面に依存する部分の設定（調整が必要なのは基本ここだけ）
```

---

## 注意事項

- **解約は元に戻せません。** もう一度使うには登録し直す必要があります。
  まずテスト実行（`--dry-run`）で導線を確認してから実行してください。
- ログイン情報はお使いのパソコン内にだけ保存され、外部には送信されません。
- Amazonの利用規約の範囲内で、ご自身のアカウントの定期おトク便を管理する目的でのみ使ってください。
- 本ツールはAmazonを非公式に自動操作するものです。利用規約違反とみなされ、
  アカウントが停止・制限される可能性があります。本ツールの利用によって生じた
  いかなる損害（アカウント停止を含む）についても、作成者は一切責任を負いません。
  自己責任でご利用ください。

## ライセンス

[MIT](./LICENSE)
