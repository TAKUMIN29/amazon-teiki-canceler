# 定期おトク便かんたん解約

Amazonの定期おトク便を、商品を選んでまとめて解約できるツールです。
Windows用のアプリと、ターミナルから使うCLIがあります。

[紹介ページ](https://takumin29.github.io/amazon-teiki-canceler/)

## ダウンロード

[最新版のリリース](https://github.com/TAKUMIN29/amazon-teiki-canceler/releases/latest) から `Setup.x.x.x.exe` をダウンロードしてください。

- 必要なもの：Windows 10/11、Google Chrome
- 署名なしのアプリなので、初回起動時に「WindowsによってPCが保護されました」と出ることがあります。「詳細情報」→「実行」で起動できます。

## 機能

- 定期おトク便の一覧表示（次回お届け日・数量・価格）
- 解約したい商品だけを選んで、まとめて解約
- テスト実行：確定ボタンの手前まで進めて止める（実際には解約しない）

## 使い方

### アプリ

1. アプリを起動し、「ログインする」から普段通りAmazonにログイン
2. 一覧から解約する商品を選ぶ
3. 「テスト実行」をONのまま一度試し、問題なければOFFにして実行

### CLI

Node.js 20以上とGoogle Chromeが必要です。

```bash
npm install
npm run login     # 初回だけ。開いたブラウザでAmazonにログイン
npm run manage    # 一覧を見ながら商品ごとに選んで解約
```

| コマンド | 内容 |
| --- | --- |
| `npm run list` | 一覧を表示 |
| `npm run manage` | 商品ごとに選んで解約 |
| `npm run start -- cancel` | 選んだ商品を解約（`--all` / `--index 1,3` / `--filter <商品名>` で指定も可） |
| `npm run inspect` | 今の画面を `out/` に保存（画面が変わって動かなくなったとき用） |

`--dry-run` を付けると、確定ボタンの手前で止まります。

## ビルド方法

```bash
git clone https://github.com/TAKUMIN29/amazon-teiki-canceler.git
cd amazon-teiki-canceler
npm install
npm run electron   # アプリを開発モードで起動
npm run dist       # インストーラを作成（dist/ に出力）
```

`v1.2.3` のようなタグをpushすると、GitHub Actionsでビルドされてリリースが作られます。

```bash
npm version patch
git push --follow-tags
```

Amazonの画面が変わって動かなくなったときは、[`config/selectors.json`](./config/selectors.json) を直せば対応できます。

## 注意

- 解約は元に戻せません。実行前に内容をよく確認してください。
- ログイン情報はお使いのパソコンにだけ保存されます。
- Amazon非公式のツールです。アカウントが制限される可能性もあるため、自己責任でご利用ください。

## ライセンス

[MIT](./LICENSE)
