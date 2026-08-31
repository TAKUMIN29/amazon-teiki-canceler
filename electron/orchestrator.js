import fs from 'node:fs';
import path from 'node:path';
import {
  launch,
  loadSelectors,
  gotoSubscriptions,
  isLoggedOut,
  anyPresent,
  sleep,
  OUT_DIR,
  LOGS_DIR,
  classifyLaunchFailure,
  isSubscriptionsUrl,
} from '../src/browser.js';
import { listSubscriptions, refresh } from '../src/scrape.js';
import { runSteps } from '../src/actions.js';

export { OUT_DIR, LOGS_DIR };

/** 商品を一意に識別するキー。実行のたびに一覧を取り直すため、番号ではなくこれで照合する。 */
const keyOf = (it) => it.asin ?? it.subscriptionId ?? it.title;

/** ブラウザセッション。アプリ起動中は使い回し、都度開き直さない。 */
let session = null;

/**
 * すでに開いているセッションを返す。無ければ（または閉じられていれば）新規に起動する。
 *
 * headless を切り替えるとブラウザを開き直す必要がある（永続プロファイルは
 * 同時に1プロセスしか掴めないため）。ログイン時は2段階認証やCAPTCHAを人が
 * 操作する必要があるので、呼び出し側が必ず headless:false を指定する。
 */
export async function ensureSession({ headless = false } = {}) {
  if (session && !session.closed) {
    if (session.headless === headless) return session;
    await closeSession(); // モードが違うので開き直す
  }

  const sel = loadSelectors();
  let ctx, page;
  try {
    ({ ctx, page } = await launch({ headless, slowMo: 0 }));
  } catch (err) {
    err.classified = classifyLaunchFailure(err.cause?.chromeError, err.cause?.chromiumError);
    throw err;
  }

  session = { ctx, page, sel, closed: false, headless };
  ctx.on('close', () => {
    if (session) session.closed = true;
  });
  return session;
}

/** ユーザーが手動でブラウザを閉じたかどうか */
export function isSessionClosed() {
  return !session || session.closed;
}

/**
 * ログインを開始する。ログインを検知する（または10分でタイムアウトする）まで待機する。
 * 2段階認証やCAPTCHAを人が操作する必要があるため、ここは必ずブラウザを表示する。
 */
export async function startLogin(onStatus = () => {}) {
  const { page, sel } = await ensureSession({ headless: false });
  await page.goto(sel.urls.subscriptions, { waitUntil: 'domcontentloaded' });
  onStatus({ state: 'waiting' });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (session?.closed) return { ok: false, closed: true };
    if (!(await isLoggedOut(page, sel))) {
      const ready = await anyPresent(page, sel.list.readyMarkers, { timeout: 1500 });
      const empty = await anyPresent(page, sel.list.emptyMarkers, { timeout: 800 });
      if (ready || empty) {
        onStatus({ state: 'success' });
        return { ok: true };
      }
    }
    await sleep(2000);
  }
  onStatus({ state: 'timeout' });
  return { ok: false, timeout: true };
}

/** 一覧を取得する。ログインしていない/認証チャレンジ中なら理由付きで返す。 */
export async function getList({ headless = false } = {}) {
  const { page, sel } = await ensureSession({ headless });
  const r = await gotoSubscriptions(page, sel);
  // ログインや本人確認が必要なら、人が操作できるよう表示ありに戻して開き直す
  if (!r.ok && headless) {
    await closeSession();
    return { ok: false, reason: r.reason };
  }
  if (!r.ok) return { ok: false, reason: r.reason };

  const { items, strategy } = await listSubscriptions(page, sel);
  return { ok: true, items, strategy };
}

/**
 * 選ばれた実行計画を1件ずつ実行する。
 * @param {Array<{asin?:string, subscriptionId?:string, title:string, action:'cancel'}>} requestedEntries
 * @param {{dryRun:boolean}} opts
 * @param {(event:object)=>void} onProgress
 */
export async function runPlan(requestedEntries, { dryRun, headless = false } = {}, onProgress = () => {}) {
  const { page, sel } = await ensureSession({ headless });

  // ブラウザが手動操作などで管理ページから移動していると、一覧抽出が別の
  // コンテンツ（おすすめ商品など）を誤って拾ってしまう。実行前に必ず確認し、
  // 違うページなら実行せずに警告を返す。
  if (!isSubscriptionsUrl(page.url(), sel)) {
    return { ok: false, reason: 'wrong-page', currentUrl: page.url() };
  }

  // 選択してから実行するまでの間に画面の状態が変わっている可能性があるため、
  // 実行直前に一覧を取り直してから現物と突き合わせる。
  const { items: freshItems } = await listSubscriptions(page, sel);
  const entries = requestedEntries.map((req) => {
    const wantKey = req.asin ?? req.subscriptionId ?? req.title;
    const target = freshItems.find((it) => keyOf(it) === wantKey) ?? null;
    const flow = sel.cancel;
    return { target, flow, action: req.action, requested: req };
  });

  const results = [];

  for (let i = 0; i < entries.length; i++) {
    const { flow, action, requested } = entries[i];
    let target = entries[i].target;
    onProgress({ type: 'item-start', index: i, total: entries.length, title: requested.title, action });

    if (!target) {
      const r = { ok: true, status: 'done', message: '一覧から消えていました（処理済みとみなします）' };
      results.push({ title: requested.title, action, ...r });
      onProgress({ type: 'item-done', index: i, total: entries.length, title: requested.title, action, ...r });
      continue;
    }

    if (i > 0) {
      const { items } = await refresh(page, sel);
      const found = items.find((it) => keyOf(it) === keyOf(target));
      if (!found) {
        const r = { ok: true, status: 'done', message: '一覧から消えていました（処理済みとみなします）' };
        results.push({ title: target.title, action, ...r });
        onProgress({ type: 'item-done', index: i, total: entries.length, title: target.title, action, ...r });
        continue;
      }
      target = { ...target, cardSelector: found.cardSelector };
    }

    const r = await runSteps(page, target, flow, {
      dryRun: !!dryRun,
      log: (message) => onProgress({ type: 'step', message }),
    });
    results.push({ title: target.title, asin: target.asin, action, ...r });
    onProgress({ type: 'item-done', index: i, total: entries.length, title: target.title, action, ...r });

    if (i < entries.length - 1) {
      onProgress({ type: 'waiting' });
      await sleep(1500 + Math.floor(Math.random() * 1500));
    }
  }

  return { ok: true, results };
}

export function writeLog(kind, dryRun, results) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(LOGS_DIR, `${kind}-${stamp}.json`);
  const body = { kind, dryRun: !!dryRun, at: new Date().toISOString(), results };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
  return file;
}

/** ブラウザセッションを閉じる（アプリ終了時、または「再試行」時に呼ぶ） */
export async function closeSession() {
  if (session && !session.closed) {
    await session.ctx.close().catch(() => {});
  }
  session = null;
}
