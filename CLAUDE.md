# CLAUDE.md

このリポジトリはAmazon「定期おトク便」の一括解約CLI/デスクトップアプリ（`teiki`）です。
CLI（`src/index.js`）とElectron製GUI（`electron/`）があり、どちらも`src/`の
ロジック層（`browser.js`/`scrape.js`/`actions.js`/`locator.js`）を共有している。

## 全体像

- Amazonに定期おトク便を操作する公開APIは無いため、Playwright + 実Chrome
  （永続プロファイル `.profile/`）でログイン済みブラウザを直接操作している。
- Amazon画面のDOM依存部分は `config/selectors.json` に完全に外出ししてある。
  **画面が変わったときに直すのは基本的にこのファイルだけ。** 詳しい手順は
  `.claude/skills/fix-teiki-selectors/SKILL.md` を参照。
- 実際のAmazonには一切アクセスせずにロジックを検証できるよう、
  `test/mock-amazon.js` にダミーのAmazon風画面を用意し、`test/run-tests.js`
  で回帰テストしている（`npm test`）。
- `config/selectors.json` の現行の内容は2026-08-30にclaude-in-chromeで実際の
  amazon.co.jpにログインして確認したDOM構造に基づく。同日、実アカウントで
  `list` と `manage`（`--dry-run`での到達確認、および実際の解約1件）の成功を
  確認済み。次にセレクタを直す/検証するときは、可能であれば同様に
  claude-in-chromeでログイン済みブラウザを操作して確認し、確定ボタンは
  ユーザーの許可なく絶対にクリックしないこと。
- **「次回スキップ」機能は2026-08-31付けで廃止した**（`skip`コマンド・GUIの
  スキップ選択・`config/selectors.json`の`skip`フローとも削除済み）。以前は
  商品の編集モーダルから「次の配達を中止する」で1商品ずつスキップできたが、
  実アカウントで確認したところAmazon側の画面構造が変わり、この導線が無くなって
  いた。今のAmazonは画面上部の「今後のお届け日数」カードから配送日単位で
  まとめてスキップする仕組み（同じ配送日の他の商品も巻き込みうる）になっており、
  商品単位で選ぶという本ツールの前提と食い違うため復活させていない。再実装する
  場合は、商品と配送日束の対応関係の扱いから設計し直す必要がある。

## 変更時の注意

- `cancel` は取り返しのつかない操作。ロジックを変更したら、まず `npm test`
  （モック環境）で通し、次に実画面へは必ず `--dry-run` から試すこと。
- セレクタの追加は「壊れた候補を書き換える」のではなく「候補配列の先頭に
  新しい候補を足す」方が安全（他の画面バリアントを壊さないため）。
- 部分一致CSS属性セレクタ（`[name*='...']` 等）は大文字小文字を無視する
  `i` フラグを付ける運用にしている（例: `select[name*='reason' i]`）。
  Amazon側の属性名がキャメルケースでも壊れないようにするため。
- `src/` 側の抽出/実行ロジックを直す場合は、`test/mock-amazon.js` に
  該当する画面パターンを再現し、`test/run-tests.js` にケースを追加してから
  直すこと。
- Windows/macOS/Linux両対応が前提。ファイルパスは `path.join`/`fileURLToPath`
  など`node:path`・`node:url`のAPIに任せ、`file://` 文字列や `URL.pathname` を
  自前で組み立てない（Windowsのドライブレターやスラッシュの数で壊れるため。
  過去に `test/mock-amazon.js` の起動判定と `test/run-tests.js` のプロファイル
  パスで実際に壊れたことがある）。開発機がWindowsのみでmacの実機が無くても、
  `test/run-tests.js` の「[8] クロスプラットフォーム」ブロックで両OS分の
  パス変換を検証しているので、そこにケースを足せば実機無しで確認できる。
