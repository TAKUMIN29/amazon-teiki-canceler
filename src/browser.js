import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveFirst, anyPresent, sleep } from './locator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const PROFILE_DIR = process.env.TEIKI_PROFILE_DIR
  ? path.resolve(process.env.TEIKI_PROFILE_DIR)
  : path.join(ROOT, '.profile');
export const OUT_DIR = path.join(ROOT, 'out');

export function loadSelectors() {
  const file = path.join(ROOT, 'config', 'selectors.json');
  const sel = JSON.parse(fs.readFileSync(file, 'utf8'));

  // テストや別ドメイン(amazon.com 等)へ向けるための上書き
  const base = process.env.TEIKI_BASE_URL;
  if (base) {
    const b = base.replace(/[/]+$/, '');
    sel.urls.base = b;
    sel.urls.subscriptions = process.env.TEIKI_SUBSCRIPTIONS_URL || `${b}/auto-deliveries`;
    sel.urls.subscriptionsFallback = process.env.TEIKI_SUBSCRIPTIONS_FALLBACK || null;
  }
  return sel;
}

/**
 * 永続プロファイルでブラウザを起動する。
 * ログイン状態が .profile/ に残るので、ログインは初回だけで済む。
 */
export async function launch({ headless = false, slowMo = 0 } = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const common = {
    headless,
    slowMo,
    viewport: { width: 1360, height: 950 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    args: ['--disable-blink-features=AutomationControlled', '--lang=ja-JP'],
  };

  let ctx;
  try {
    // 実際にインストールされている Chrome を使う（検知されにくく、挙動も本物と同じ）
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...common, channel: 'chrome' });
  } catch {
    // Chrome が見つからなければ Playwright 同梱の Chromium にフォールバック
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, common);
  }

  ctx.setDefaultTimeout(20000);
  ctx.setDefaultNavigationTimeout(45000);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

/** 定期おトク便の管理ページを開く。ログインが必要なら false を返す。 */
export async function gotoSubscriptions(page, sel) {
  await page.goto(sel.urls.subscriptions, { waitUntil: 'domcontentloaded' });
  await settle(page);

  if (await isLoggedOut(page, sel)) return { ok: false, reason: 'login' };
  if (await anyPresent(page, sel.auth.challengeMarkers, { timeout: 1200 })) {
    return { ok: false, reason: 'challenge' };
  }

  // 主URLで一覧が出なければ旧URLも試す
  const ready = await anyPresent(page, sel.list.readyMarkers, { timeout: 6000 });
  const empty = await anyPresent(page, sel.list.emptyMarkers, { timeout: 800 });
  if (!ready && !empty && sel.urls.subscriptionsFallback) {
    await page.goto(sel.urls.subscriptionsFallback, { waitUntil: 'domcontentloaded' });
    await settle(page);
    if (await isLoggedOut(page, sel)) return { ok: false, reason: 'login' };
  }
  return { ok: true };
}

export async function isLoggedOut(page, sel) {
  if (/\/ap\/signin/.test(page.url())) return true;
  return await anyPresent(page, sel.auth.loggedOutMarkers, { timeout: 1200 });
}

/** ネットワークが落ち着くまで待つ（Amazonは遅延描画が多いため） */
export async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await sleep(ms);
}

/** 遅延読み込みのカードを出しきるために最下部までスクロール */
export async function scrollToBottom(page) {
  let last = -1;
  for (let i = 0; i < 25; i++) {
    const h = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    if (h === last) break;
    last = h;
    await sleep(600);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
}

/** デバッグ用に現在の画面を保存 */
export async function dump(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(OUT_DIR, `${name}-${stamp}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${base}.html`, await page.content().catch(() => ''), 'utf8');
  return base;
}

export { resolveFirst, anyPresent, sleep };
