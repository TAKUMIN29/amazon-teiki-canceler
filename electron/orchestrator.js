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
 * GUIでは常にブラウザを表示して操作する（ログイン時の2段階認証やCAPTCHAを
 * 人が操作でき、Amazonに自動操作と判定されにくくするため）。
 */
export async function ensureSession() {
  if (session && !session.closed) return session;

  const sel = loadSelectors();
  let ctx, page;
  try {
    ({ ctx, page } = await launch({ headless: false, slowMo: 0 }));
  } catch (err) {
    err.classified = classifyLaunchFailure(err.cause?.chromeError, err.cause?.chromiumError);
    throw err;
  }

  session = { ctx, page, sel, closed: false };
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
  const { page, sel } = await ensureSession();
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
export async function getList() {
  const { page, sel } = await ensureSession();
  const r = await gotoSubscriptions(page, sel);
  if (!r.ok) return { ok: false, reason: r.reason };

  // 抽出方法(strategy)などの内部情報は画面に出さないので返さない
  const { items } = await listSubscriptions(page, sel);
  return { ok: true, items };
}

/**
 * 選ばれた実行計画を1件ずつ実行する。
 * @param {Array<{asin?:string, subscriptionId?:string, title:string, action:'cancel'}>} requestedEntries
 * @param {{dryRun:boolean}} opts
 * @param {(event:object)=>void} onProgress
 */
export async function runPlan(requestedEntries, { dryRun } = {}, onProgress = () => {}) {
  const { page, sel } = await ensureSession();

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

    const r = forDisplay(
      await runSteps(page, target, flow, {
        dryRun: !!dryRun,
        log: (_cliText, info) => onProgress({ type: 'step', message: stepMessage(info) }),
      }),
    );
    results.push({ title: target.title, asin: target.asin, action, ...r });
    onProgress({ type: 'item-done', index: i, total: entries.length, title: target.title, action, ...r });

    if (i < entries.length - 1) {
      onProgress({ type: 'waiting' });
      await sleep(1500 + Math.floor(Math.random() * 1500));
    }
  }

  return { ok: true, results };
}

/**
 * runSteps のログ情報を画面向けの文言にする。CLI向けの文字列にはセレクタ
 * (role[name=...] / css=... 等)が含まれるので、画面には出さない。
 */
function stepMessage({ step, outcome, value } = {}) {
  switch (outcome) {
    case 'clicked':
      return `・${step}`;
    case 'chosen':
      return `・${step}（${value ?? '既定の理由'}）`;
    case 'dry-run-stop':
      return `・${step} … ここで停止しました（テスト実行のため実際には解約していません）`;
    case 'skipped':
      return `・${step} … 該当する画面が無かったため省略しました`;
    default:
      return `・${step ?? '処理中'}`;
  }
}

/**
 * runSteps の結果を画面向けの文言に置き換える。元の詳細なメッセージ（保存した
 * 画面のファイル名やセレクタ設定の案内など）は detail としてログファイルにだけ残す。
 */
function forDisplay(r) {
  const friendly = {
    'dry-run': 'テスト実行：最後の確定ボタンの手前まで進めました（解約はしていません）',
    done: '解約しました',
    'done-unverified': '解約操作は完了しましたが、完了メッセージを確認できませんでした。Amazonの画面で状態をご確認ください',
    'not-found': '画面上で必要なボタンが見つからず、解約できませんでした。Amazonの画面が変わった可能性があります',
    'click-failed': 'ボタンを押せなかったため、解約できませんでした。もう一度お試しください',
  }[r.status];
  if (!friendly) return r;
  return { ...r, message: friendly, detail: r.message };
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
