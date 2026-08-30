# amazon-teiki-canceler

Amazonの「定期おトク便」を、任意の商品またはすべての商品について
**一括で解約 (cancel) / 次回スキップ (skip)** できるCLIツールです。

Amazonに定期おトク便を操作する公開APIは無いため、Playwrightでログイン済みの
実Chromeを操作する形で実現しています。操作対象のDOM構造は
[`config/selectors.json`](./config/selectors.json) に外出ししてあるので、
Amazon側の画面が変わってもロジック本体（`src/`）を直す必要は基本的にありません。

## できること

- `list` — 定期おトク便の一覧をターミナルに表示（商品名・次回お届け日・数量・価格など）
- `cancel` — 選んだ商品（または `--all` で全商品）の定期購入を解約
- `skip` — 選んだ商品の次回お届け分だけをスキップ（定期購入自体は継続）
- `--dry-run` — 最後の確定ボタンの手前まで実際に画面を操作して確認し、確定は押さない
- `--index` / `--filter` / 対話選択（チェックボックス）のいずれでも対象を選べる
- 実行結果は `logs/` に、失敗時の画面キャプチャは `out/` に自動保存

## セットアップ

```bash
npm install
npx playwright install chrome   # 初回のみ（システムのChromeが使えない場合）
npm run login                   # ブラウザが開くのでAmazonにログイン（初回のみ）
```

ログイン情報は `.profile/`（このリポジトリ配下の永続プロファイル）に保存されます。
2回目以降は `npm run login` を実行し直す必要はありません。

## 使い方

```bash
# 一覧表示
npm run list

# 対話的に選んで解約（チェックボックスで選択）
npm run start -- cancel

# 全商品を対象に、確定の手前まで動作確認（実際には解約しない）
npm run start -- cancel --all --dry-run

# 番号指定でスキップ（1,3,5〜7番目）
npm run start -- skip --index 1,3,5-7

# 商品名で絞り込んで一括解約（確認プロンプトなし）
npm run start -- cancel --filter "ティシュー" --all --yes
```

`cancel --all` のように**全件を無条件で選ぶ**操作は、実行前に `CANCEL` という
文字列の入力を求める追加確認が入ります（`-y/--yes` で省略可）。

### 画面が変わって動かなくなったとき

```bash
npm run inspect
```

現在の画面のスクリーンショット・HTML・候補ボタン一覧を `out/` に保存します。
`config/selectors.json` の候補を追記するだけで直る設計です。手順の詳細は
`.claude/skills/fix-teiki-selectors/SKILL.md` にまとめてあります。

## テスト

実際のAmazonには一切アクセスせず、ローカルに用意したダミーのAmazon風画面
（`test/mock-amazon.js`）に対してCLIのロジック（一覧抽出・折りたたみパネル操作・
理由選択・確定・dry-run・連続実行時の再同定など）を検証します。

```bash
npm test
```

## ディレクトリ構成

```
src/
  index.js      CLIエントリポイント（login/list/cancel/skip/inspect）
  browser.js    ブラウザ起動・ページ遷移・ログイン判定
  scrape.js     定期おトク便カードの検出とフィールド抽出
  actions.js    設定ファイルのステップ列を実行するエンジン
  locator.js    セレクタ仕様(JSON) → Playwright Locator への変換
  ui.js         ターミナルの一覧表示・選択・確認プロンプト
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
