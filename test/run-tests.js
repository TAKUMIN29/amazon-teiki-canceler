/**
 * ニセAmazon画面に対して、抽出→選択→実行までを通しで検証する。
 *
 *   npm test
 *
 * 実際のAmazonのDOMは検証できないが、
 * 「カード検出 / フィールド抽出 / 折りたたみを開く / 理由選択 / 確定 / dry-run が止まるか」
 * といったロジック側の正しさはここで担保する。
 */
import { createServer } from './mock-amazon.js';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.TEIKI_BASE_URL = BASE;
process.env.TEIKI_PROFILE_DIR = new URL('../.profile-test', import.meta.url).pathname.replace(/^\//, '');

const { launch, loadSelectors, settle } = await import('../src/browser.js');
const { listSubscriptions } = await import('../src/scrape.js');
const { runSteps } = await import('../src/actions.js');
const { parseIndexes } = await import('../src/ui.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const state = () => fetch(`${BASE}/__state`).then((r) => r.json());
const reset = () => fetch(`${BASE}/__reset`).then((r) => r.json());

const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const sel = loadSelectors();
const { ctx, page } = await launch({ headless: true });

async function openList(mode) {
  await page.goto(`${BASE}/auto-deliveries${mode ? `?mode=${mode}` : ''}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 300);
  return listSubscriptions(page, sel);
}

try {
  /* ---------- 1. 目印あり(rich)の抽出 ---------- */
  console.log('\n[1] 一覧の抽出 — data-subscription-id あり');
  await reset();
  let r = await openList('rich');
  check('5件すべて検出できる', r.items.length === 5, `検出: ${r.items.length}件`);
  check('設定セレクタ経路が使われる', r.strategy.startsWith('css:'), `strategy=${r.strategy}`);
  check('商品名が取れる', r.items[0].title.includes('アタック抗菌EXパワー'), r.items[0].title);
  check('次回お届け日が取れる', /2026年9月12日/.test(r.items[0].nextDelivery ?? ''), String(r.items[0].nextDelivery));
  check('価格が取れる', (r.items[0].price ?? '').includes('1,180'), String(r.items[0].price));
  check('ASINが取れる', r.items[0].asin === 'B08XYZ1234', String(r.items[0].asin));
  check('購読IDが取れる', r.items[0].subscriptionId === 'SUB-001', String(r.items[0].subscriptionId));
  check('商品ごとに別カードになっている', new Set(r.items.map((i) => i.asin)).size === 5);

  /* ---------- 2. 目印なし(plain)の抽出 ---------- */
  console.log('\n[2] 一覧の抽出 — 目印なし（ヒューリスティック経路）');
  r = await openList('plain');
  check('5件すべて検出できる', r.items.length === 5, `検出: ${r.items.length}件`);
  check('ヒューリスティック経路が使われる', r.strategy.startsWith('heuristic:'), `strategy=${r.strategy}`);
  check('商品名が取れる', r.items[2].title.includes('サントリー天然水'), r.items[2].title);
  check('カードが入れ子になっていない', new Set(r.items.map((i) => i.asin)).size === 5);

  /* ---------- 3. dry-run は実行しない ---------- */
  console.log('\n[3] dry-run — 確定の手前で止まる');
  await reset();
  r = await openList('rich');
  let res = await runSteps(page, r.items[0], sel.cancel, { dryRun: true });
  check('dry-run として完了する', res.ok && res.status === 'dry-run', `${res.status}: ${res.message}`);
  check('最終ボタンまで到達している', res.trace.some((t) => t.result === 'dry-run-stop'), JSON.stringify(res.trace));
  check('サーバ側は1件も減っていない', (await state()).length === 5);

  /* ---------- 4. 解約の実行 ---------- */
  console.log('\n[4] 解約 — 折りたたみを開く → 理由を選ぶ → 確定');
  await reset();
  r = await openList('rich');
  res = await runSteps(page, r.items[1], sel.cancel, { dryRun: false });
  check('解約が完了する', res.ok && res.status === 'done', `${res.status}: ${res.message}`);
  check('成功メッセージを検知できる', res.status === 'done');
  let s = await state();
  check('サーバ側から1件消える', s.length === 4, `残り${s.length}件`);
  check('消えたのは指定した商品', !s.some((x) => x.sid === 'SUB-002'), JSON.stringify(s.map((x) => x.sid)));
  check('理由が選択されている', res.trace.some((t) => t.value && String(t.value).length > 0), JSON.stringify(res.trace));

  /* ---------- 5. 連続解約（番号ずれの検証） ---------- */
  console.log('\n[5] 連続解約 — 1件ごとに一覧を取り直して同定する');
  await reset();
  r = await openList('rich');
  const targets = [r.items[0], r.items[4]]; // 先頭と末尾（途中で番号がずれる組み合わせ）
  const keys = targets.map((t) => t.asin);
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) {
      const again = await openList('rich');
      const found = again.items.find((it) => it.asin === keys[i]);
      check(`2件目を再同定できる (${keys[i]})`, !!found, JSON.stringify(again.items.map((x) => x.asin)));
      targets[i].cardSelector = found?.cardSelector;
    }
    const rr = await runSteps(page, targets[i], sel.cancel, { dryRun: false });
    check(`${i + 1}件目の解約が完了`, rr.ok && rr.status === 'done', `${rr.status}: ${rr.message}`);
  }
  s = await state();
  check('2件減って3件になる', s.length === 3, `残り${s.length}件`);
  check('正しい2件が消えている', !s.some((x) => ['SUB-001', 'SUB-005'].includes(x.sid)), JSON.stringify(s.map((x) => x.sid)));

  /* ---------- 6. スキップ ---------- */
  console.log('\n[6] 次回分のスキップ');
  await reset();
  r = await openList('rich');
  res = await runSteps(page, r.items[2], sel.skip, { dryRun: false });
  check('スキップが完了する', res.ok && res.status.startsWith('done'), `${res.status}: ${res.message}`);
  s = await state();
  check('対象がスキップ済みになる', s.find((x) => x.sid === 'SUB-003')?.skipped === true, JSON.stringify(s.map((x) => [x.sid, x.skipped])));
  check('件数は減っていない（解約されていない）', s.length === 5, `${s.length}件`);
  check('他の商品はスキップされていない', s.filter((x) => x.skipped).length === 1);

  /* ---------- 6.5. manage相当: 商品ごとに違う操作を混在させる ---------- */
  console.log('\n[6.5] 混在実行 — 1件はスキップ、別の1件は解約（manageコマンド相当）');
  await reset();
  r = await openList('rich');
  const mixPlan = [
    { item: r.items[0], action: 'skip' },
    { item: r.items[3], action: 'cancel' },
  ];
  for (let i = 0; i < mixPlan.length; i++) {
    const { item, action } = mixPlan[i];
    if (i > 0) {
      const again = await openList('rich');
      const found = again.items.find((it) => it.asin === item.asin);
      check(`混在実行: 2件目(${action})を再同定できる`, !!found, JSON.stringify(again.items.map((x) => x.asin)));
      item.cardSelector = found?.cardSelector;
    }
    const rr = await runSteps(page, item, action === 'cancel' ? sel.cancel : sel.skip, { dryRun: false });
    check(`混在実行: ${i + 1}件目(${action})が完了`, rr.ok && rr.status.startsWith('done'), `${rr.status}: ${rr.message}`);
  }
  s = await state();
  check('混在実行: スキップ対象は残っている', s.some((x) => x.sid === 'SUB-001'), JSON.stringify(s.map((x) => x.sid)));
  check('混在実行: スキップ対象がskipped扱いになる', s.find((x) => x.sid === 'SUB-001')?.skipped === true);
  check('混在実行: 解約対象は消えている', !s.some((x) => x.sid === 'SUB-004'), JSON.stringify(s.map((x) => x.sid)));
  check('混在実行: 他の商品は影響を受けない', s.length === 4 && s.filter((x) => x.skipped).length === 1, JSON.stringify(s));

  /* ---------- 7. 見つからないときの扱い ---------- */
  console.log('\n[7] セレクタが合わないとき');
  await reset();
  r = await openList('rich');
  const broken = { ...sel.cancel, steps: sel.cancel.steps.map((st) => ({ ...st, target: [{ css: '.存在しないクラス' }] })) };
  res = await runSteps(page, r.items[0], broken, { dryRun: false });
  check('失敗として返る（例外にならない）', res.ok === false && res.status === 'not-found', JSON.stringify(res));
  check('直し方の案内が含まれる', /selectors\.json/.test(res.message), res.message);
  check('サーバ側は変更されていない', (await state()).length === 5);

  /* ---------- 8. 番号指定のパース ---------- */
  console.log('\n[8] --index のパース');
  check('"1,3" → [1,3]', JSON.stringify(parseIndexes('1,3', 5)) === '[1,3]');
  check('"2-4" → [2,3,4]', JSON.stringify(parseIndexes('2-4', 5)) === '[2,3,4]');
  check('"5-2" のような逆順も扱える', JSON.stringify(parseIndexes('5-2', 5)) === '[2,3,4,5]');
  check('重複は除かれる', JSON.stringify(parseIndexes('1,1,2-3,3', 5)) === '[1,2,3]');
  check('範囲外はエラーになる', throws(() => parseIndexes('9', 5)));
  check('不正な書式はエラーになる', throws(() => parseIndexes('abc', 5)));
} finally {
  await ctx.close().catch(() => {});
  server.close();
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(fail === 0 ? `\x1b[32m全 ${pass} 件パス\x1b[0m` : `\x1b[32m${pass} 件パス\x1b[0m / \x1b[31m${fail} 件失敗\x1b[0m`);
if (fail) console.log('失敗: ' + failures.join(', '));
console.log('');
process.exit(fail ? 1 : 0);
