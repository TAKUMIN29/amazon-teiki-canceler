---
name: fix-teiki-selectors
description: Amazon定期おトク便キャンセルCLI(teiki)が「要素が見つからない」等で失敗したとき、config/selectors.jsonのセレクタを実画面に合わせて修正する。Amazonの画面リニューアルでlist/cancel/skipが動かなくなった場合に使う。
---

# teiki セレクタ修復スキル

このリポジトリ（Amazon定期おトク便 一括解約/スキップCLI）は、Amazonの画面のDOM構造を
`config/selectors.json` に外出ししている。Amazon側の画面が変わると `list` / `cancel` / `skip`
が「要素が見つかりません」で失敗するようになるが、直すのは基本的にこの1ファイルだけでよい。

## 手順

1. **現状を吸い出す**
   ```
   npm run inspect
   ```
   `out/inspect-<timestamp>.png`（画面キャプチャ）、`.html`（生DOM）、
   `-items.json`（現在の抽出結果と使われた戦略）、`-buttons.json`
   （「キャンセル/スキップ/変更/定期/解約/停止/設定」を含むボタン・リンク候補）が出力される。
   まず `-buttons.json` と `-items.json` を読み、何が変わったかを特定する。

2. **失敗ログを確認する**
   `cancel`/`skip` が失敗すると `logs/<kind>-<timestamp>.json` に各ステップの trace が残り、
   `not-found` になったステップの `description` でどの操作が壊れたか分かる。
   同時に `out/fail-*.png` / `.html` も保存されているので、その時点の画面も参照できる。

3. **`config/selectors.json` を直す**
   - 各 `target` は「候補の配列」。上から順に試して最初に存在するものを使うので、
     壊れた候補を直接書き換えるより、**新しい候補を配列の先頭に追加する**方が安全
     （古い候補が別の画面バリアントでまだ有効な可能性があるため）。
   - 候補の書き方は `config/selectors.json` 冒頭の `_comment` を参照:
     `{ "css": ... }` / `{ "role": ..., "name": ... }` / `{ "text": ... }` / `{ "xpath": ... }`。
   - `name*='reason'` のような部分一致CSS属性セレクタは大文字小文字を区別しない
     `i` フラグを付けて書く（例: `select[name*='reason' i]`）。Amazon側の属性名が
     `cancelReason` のようにキャメルケースでも壊れないようにするため。
   - 一覧のカード検出がそもそも0件になっている場合は `list.card` の候補を見直す。
     `list.card` が空でも `heuristic:anchor-ancestor`（商品リンクの祖先をたどる方式）に
     自動フォールバックするので、まずそちらの抽出結果（`strategy`）で件数が出ているか確認する。
   - 「最後の一歩」（解約/スキップの最終確定ボタン）には `pointOfNoReturn: true` が
     付いている。ここだけは `--dry-run` で実クリックせずに到達確認できるので、
     セレクタを直したら必ず `--dry-run` から試す。

4. **検証する**
   - JSONの妥当性だけなら:
     ```
     node -e "JSON.parse(require('fs').readFileSync('config/selectors.json','utf8'));console.log('OK')"
     ```
   - ロジック全体の回帰確認（本物のAmazonには触れない）:
     ```
     npm test
     ```
     `test/mock-amazon.js` はカード検出・折りたたみパネル・理由選択・成功メッセージなど
     実画面の癖を模したダミーのAmazon画面。ここが通っていれば、CLI側のロジックは壊れていない
     ＝残る原因は `selectors.json` の候補が実画面と合っていないことに絞れる。
   - 最後に実画面で確認:
     ```
     npm run start -- list
     npm run start -- cancel --dry-run --all
     ```

## 注意

- `config/selectors.json` 以外のソース（`src/*.js`）を直す必要が生じた場合は、
  それはセレクタの問題ではなく抽出/実行ロジック自体の不具合の可能性が高い。
  その場合は `test/mock-amazon.js` に該当パターン（新しい画面構造）を再現し、
  `test/run-tests.js` にケースを追加してから直すこと。
- 解約(cancel)は取り返しがつかない操作なので、セレクタ修正後の動作確認は
  必ず `--dry-run` または `skip` から行い、実解約で試さない。
