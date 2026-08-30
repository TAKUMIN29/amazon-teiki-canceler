#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { launch, loadSelectors, gotoSubscriptions, isLoggedOut, dump, sleep, anyPresent, ROOT } from './browser.js';
import { listSubscriptions, refresh } from './scrape.js';
import { runSteps } from './actions.js';
import {
  renderList,
  selectItems,
  parseIndexes,
  confirmRun,
  renderSummary,
  planActions,
  renderPlanSummary,
  confirmPlan,
  kleur,
} from './ui.js';

const program = new Command();
program
  .name('teiki')
  .description('Amazon定期おトク便を一括で解約/スキップするツール')
  .version('1.0.0');

const browserOpts = (cmd) =>
  cmd
    .option('--headless', 'ブラウザを表示せずに実行する（初回ログイン後のみ推奨）', false)
    .option('--slow <ms>', '各操作の間に待ちを入れる（デバッグ用）', (v) => Number(v), 0);

/** 商品を一意に識別するキー。実行のたびに一覧を取り直すため、番号ではなくこれで照合する。 */
const keyOf = (it) => it.asin ?? it.subscriptionId ?? it.title;

/* ---------------------------------------------------------------- login */

browserOpts(program.command('login'))
  .description('Amazonにログインしてセッションを保存する（初回だけ実行すればOK）')
  .action(async (opts) => {
    const sel = loadSelectors();
    const { ctx, page } = await launch({ headless: false, slowMo: opts.slow });
    try {
      await page.goto(sel.urls.subscriptions, { waitUntil: 'domcontentloaded' });
      console.log(kleur.bold('\n開いたブラウザでAmazonにログインしてください。'));
      console.log(kleur.gray('  2段階認証やCAPTCHAもそのまま画面上で操作してください。'));
      console.log(kleur.gray('  ログインが完了すると自動で検知します（最大10分待機）。\n'));

      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        if (!(await isLoggedOut(page, sel))) {
          const ready = await anyPresent(page, sel.list.readyMarkers, { timeout: 1500 });
          const empty = await anyPresent(page, sel.list.emptyMarkers, { timeout: 800 });
          if (ready || empty) {
            console.log(kleur.green('✓ ログインを確認しました。セッションを .profile/ に保存しました。'));
            console.log(kleur.gray('  次回からは `npm run list` などがそのまま使えます。\n'));
            return;
          }
        }
        await sleep(2000);
      }
      console.log(kleur.yellow('タイムアウトしました。もう一度 `npm run login` を試してください。'));
    } finally {
      await ctx.close();
    }
  });

/* ----------------------------------------------------------------- list */

browserOpts(program.command('list'))
  .description('定期おトク便の一覧を表示する')
  .option('--json', 'JSONで出力する', false)
  .action(async (opts) => {
    await withPage(opts, async ({ page, sel }) => {
      const { items, strategy } = await listSubscriptions(page, sel);
      if (opts.json) {
        console.log(JSON.stringify({ strategy, count: items.length, items }, null, 2));
      } else {
        renderList(items);
        console.log(kleur.gray(`  （抽出方法: ${strategy}）\n`));
      }
    });
  });

/* --------------------------------------------------------- cancel / skip */

for (const kind of ['cancel', 'skip']) {
  const isCancel = kind === 'cancel';
  const cmd = browserOpts(program.command(kind))
    .description(isCancel ? '定期購入を解約する（元に戻せません）' : '次回のお届けをスキップする')
    .option('--all', 'すべての商品を対象にする', false)
    .option('--index <spec>', '番号で指定する（例: 1,3,5-7）')
    .option('--filter <text>', '商品名に含まれる文字列で絞り込む')
    .option('--dry-run', '最後の確定ボタンの手前まで動作を確認する（実行はしない）', false)
    .option('-y, --yes', '確認プロンプトを省略する', false);

  cmd.action(async (opts) => {
    await withPage(opts, async ({ page, sel }) => {
      const flow = sel[kind];
      const { items } = await listSubscriptions(page, sel);
      if (items.length === 0) {
        console.log(kleur.yellow('\n対象の定期おトク便がありません。\n'));
        return;
      }
      renderList(items);

      const targets = await pickTargets(items, opts, flow.label);
      if (targets.length === 0) {
        console.log(kleur.yellow('対象が選ばれませんでした。終了します。\n'));
        return;
      }

      if (!opts.yes) {
        const ok = await confirmRun(targets, flow.label, {
          destructive: isCancel && !opts.dryRun,
          requireTyping: isCancel && !opts.dryRun && targets.length === items.length && items.length > 1,
        });
        if (!ok) return;
      }

      const entries = targets.map((target) => ({ target, flow }));
      const results = await executeAll(page, sel, entries, opts);
      renderSummary(results);
      writeLog(kind, opts, results);
    });
  });
}

/* --------------------------------------------------------------- manage */

browserOpts(program.command('manage'))
  .description('一覧を見ながら、商品ごとにスキップ/解約を選んで一括実行する')
  .option('--dry-run', '最後の確定ボタンの手前まで動作を確認する（実行はしない）', false)
  .option('-y, --yes', '確認プロンプトを省略する', false)
  .action(async (opts) => {
    await withPage(opts, async ({ page, sel }) => {
      const { items } = await listSubscriptions(page, sel);
      if (items.length === 0) {
        console.log(kleur.yellow('\n対象の定期おトク便がありません。\n'));
        return;
      }
      renderList(items);

      const plan = await planActions(items);
      renderPlanSummary(plan);
      if (plan.length === 0) {
        console.log(kleur.gray('終了します。\n'));
        return;
      }

      if (!opts.yes) {
        const ok = await confirmPlan(plan);
        if (!ok) return;
      }

      const entries = plan.map(({ item, action }) => ({
        target: item,
        flow: action === 'cancel' ? sel.cancel : sel.skip,
        action,
      }));
      const results = await executeAll(page, sel, entries, opts);
      renderSummary(results);
      writeLog('manage', opts, results);
    });
  });

/* -------------------------------------------------------------- inspect */

browserOpts(program.command('inspect'))
  .description('現在の画面のHTMLとスクリーンショットを out/ に保存する（セレクタ調整用）')
  .action(async (opts) => {
    await withPage(opts, async ({ page, sel }) => {
      const { items, strategy } = await listSubscriptions(page, sel);
      const base = await dump(page, 'inspect');

      const cand = await page.evaluate(() => {
        const seen = new Map();
        const nodes = document.querySelectorAll('a, button, input[type=submit], [role=button]');
        for (const el of nodes) {
          const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
          const label = raw.replace(/\s+/g, ' ').trim();
          if (!label || label.length > 40) continue;
          if (!/キャンセル|スキップ|変更|定期|解約|停止|設定/.test(label)) continue;
          const key = el.tagName.toLowerCase() + '|' + label;
          if (seen.has(key)) continue;
          seen.set(key, {
            tag: el.tagName.toLowerCase(),
            label,
            href: el.getAttribute('href'),
            id: el.id || null,
            class: typeof el.className === 'string' ? el.className : null,
          });
        }
        return Array.from(seen.values());
      });

      fs.writeFileSync(`${base}-buttons.json`, JSON.stringify(cand, null, 2), 'utf8');
      fs.writeFileSync(`${base}-items.json`, JSON.stringify({ strategy, items }, null, 2), 'utf8');

      console.log(kleur.green('\n✓ 保存しました:'));
      console.log(`   ${base}.png            画面全体のスクリーンショット`);
      console.log(`   ${base}.html           ページのHTML`);
      console.log(`   ${base}-items.json     抽出できた商品一覧（抽出方法: ${strategy}）`);
      console.log(`   ${base}-buttons.json   関係のありそうなボタン/リンク ${cand.length} 件`);
      console.log(kleur.gray('\n  buttons.json の label を config/selectors.json の候補に足すと精度が上がります。\n'));
    });
  });

/* ------------------------------------------------------------- helpers */

/** ブラウザを開いて共通の前処理（ログイン確認）を済ませ、本体を実行する */
async function withPage(opts, fn) {
  const sel = loadSelectors();
  const { ctx, page } = await launch({ headless: !!opts.headless, slowMo: opts.slow ?? 0 });
  try {
    const r = await gotoSubscriptions(page, sel);
    if (!r.ok) {
      if (r.reason === 'login') {
        console.log(kleur.red('\nログインしていません。まず `npm run login` を実行してください。'));
        if (opts.headless) console.log(kleur.gray('（--headless ではログインできません）'));
      } else {
        console.log(kleur.red('\nAmazonが認証確認(CAPTCHA/2段階認証)を求めています。'));
        console.log(kleur.gray('`npm run login` を実行して画面上で解除してください。'));
      }
      console.log('');
      process.exitCode = 1;
      return;
    }
    await fn({ page, sel, ctx });
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** --all / --index / --filter / 対話選択 から対象を決める */
async function pickTargets(items, opts, actionLabel) {
  let pool = items;
  if (opts.filter) {
    const q = opts.filter.toLowerCase();
    pool = items.filter((it) => (it.title ?? '').toLowerCase().includes(q));
    console.log(kleur.gray(`  --filter "${opts.filter}" で ${pool.length} 件に絞り込みました。`));
    if (pool.length === 0) return [];
  }
  if (opts.index) {
    const idx = parseIndexes(opts.index, items.length);
    return items.filter((it) => idx.includes(it.index));
  }
  if (opts.all) return pool;
  return await selectItems(pool, actionLabel);
}

/**
 * entries を1件ずつ実行する。entry ごとに使う flow（cancel/skip）を変えられるので、
 * cancel/skip コマンド（全件同じ操作）と manage コマンド（商品ごとに違う操作）の
 * 両方から使える。1件終わるたびに一覧を取り直し、キーで対象を探し直す
 * （解約後はカードが消えて番号がずれるため、番号は使い回せない）。
 */
async function executeAll(page, sel, entries, opts) {
  const results = [];

  for (let i = 0; i < entries.length; i++) {
    let { target, flow, action } = entries[i];
    const label = action ? `(${action === 'cancel' ? '解約' : 'スキップ'}) ` : '';
    console.log(kleur.bold(`\n[${i + 1}/${entries.length}] ${label}${target.title}`));

    if (i > 0) {
      const { items } = await refresh(page, sel);
      const found = items.find((it) => keyOf(it) === keyOf(target));
      if (!found) {
        results.push({
          title: target.title,
          action,
          ok: true,
          status: 'done',
          message: '一覧から消えていました（処理済みとみなします）',
        });
        console.log(kleur.gray('    一覧に見つからないため、処理済みとしてスキップします。'));
        continue;
      }
      target.cardSelector = found.cardSelector;
    }

    const r = await runSteps(page, target, flow, {
      dryRun: !!opts.dryRun,
      log: (m) => console.log(kleur.gray(m)),
    });
    results.push({ title: target.title, asin: target.asin, action, ...r });
    console.log(r.ok ? kleur.green(`    → ${r.message}`) : kleur.red(`    → ${r.message}`));

    // 連続実行で不自然な速さにならないよう、少し間を置く
    if (i < entries.length - 1) await sleep(1500 + Math.floor(Math.random() * 1500));
  }
  return results;
}

function writeLog(kind, opts, results) {
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${kind}-${stamp}.json`);
  const body = { kind, dryRun: !!opts.dryRun, at: new Date().toISOString(), results };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
  console.log(kleur.gray(`  ログ: ${path.relative(ROOT, file)}\n`));
}

/* ---------------------------------------------------------------- main */

process.on('unhandledRejection', (e) => {
  console.error(kleur.red(`\n予期しないエラー: ${e?.message ?? e}\n`));
  process.exit(1);
});

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e?.name === 'ExitPromptError') {
    console.log(kleur.yellow('\n中断しました。\n'));
    process.exit(130);
  }
  console.error(kleur.red(`\nエラー: ${e?.message ?? e}\n`));
  process.exit(1);
}
