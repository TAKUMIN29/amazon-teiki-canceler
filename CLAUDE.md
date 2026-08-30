# CLAUDE.md

このリポジトリはAmazon「定期おトク便」の一括解約/スキップCLI（`teiki`）です。

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
  確認済み。スキップ操作は実アカウントでは未確認。次にセレクタを直す/検証する
  ときは、可能であれば同様にclaude-in-chromeでログイン済みブラウザを操作して
  確認し、確定ボタンはユーザーの許可なく絶対にクリックしないこと。

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
  `test/run-tests.js` の「[9] クロスプラットフォーム」ブロックで両OS分の
  パス変換を検証しているので、そこにケースを足せば実機無しで確認できる。
