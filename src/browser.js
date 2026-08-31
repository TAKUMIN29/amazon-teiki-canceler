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
export const OUT_DIR = process.env.TEIKI_OUT_DIR
  ? path.resolve(process.env.TEIKI_OUT_DIR)
  : path.join(ROOT, 'out');
export const LOGS_DIR = process.env.TEIKI_LOGS_DIR
  ? path.resolve(process.env.TEIKI_LOGS_DIR)
  : path.join(ROOT, 'logs');

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
    // 実際にインストールされている Chrome を使う（検知されにくく、挙動も本物と同じ）。
    // channel:'chrome' はWindows/macOS/Linuxのいずれでも既定のインストール先を探してくれる。
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...common, channel: 'chrome' });
  } catch (chromeError) {
    try {
      // Chrome が見つからなければ Playwright 同梱の Chromium にフォールバック
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, common);
    } catch (chromiumError) {
      throw new Error(explainLaunchFailure(chromeError, chromiumError), { cause: { chromeError, chromiumError } });
    }
  }

  ctx.setDefaultTimeout(20000);
  ctx.setDefaultNavigationTimeout(45000);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

/**
 * ブラウザ起動失敗の原因を分類する（プロファイル使用中 / Chrome未インストール、の2択）。
 * GUI版がエラー画面を出し分けるためにも使うので export している。
 */
export function classifyLaunchFailure(chromeError, chromiumError) {
  const both = `${chromeError?.message ?? ''}\n${chromiumError?.message ?? ''}`;
  if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(both)) {
    return { kind: 'profile-in-use' };
  }
  return { kind: 'chrome-missing' };
}

/**
 * ブラウザが起動できなかったときに、原因別の対処法を添えたメッセージを組み立てる。
 * ブラウザが無い/プロファイルが使用中、のどちらかであることがほとんど。
 */
function explainLaunchFailure(chromeError, chromiumError) {
  const detail = String(chromiumError?.message ?? chromiumError).split('\n')[0];
  const { kind } = classifyLaunchFailure(chromeError, chromiumError);

  if (kind === 'profile-in-use') {
    return [
      'ブラウザを起動できませんでした（プロファイルが使用中の可能性があります）。',
      `  ${detail}`,
      '',
      'このツールが前回開いたChromeのウィンドウが残っていないか確認して、閉じてから再実行してください。',
      `  プロファイル: ${PROFILE_DIR}`,
    ].join('\n');
  }

  return [
    'ブラウザを起動できませんでした。',
    `  ${detail}`,
    '',
    'Google Chrome が入っていない場合は、次のどちらかを実行してください:',
    '  1) Google Chrome をインストールする（推奨）',
    '  2) Playwright同梱のChromiumを入れる:  npx playwright install chromium',
  ].join('\n');
}

/**
 * 定期おトク便の管理ページを開く。ログインが必要なら false を返す。
 * ログアウト/認証チャレンジの判定は「無い」ことを確認するチェックなので、
 * 該当しない（＝通常ログイン済みの）場合は候補が見つからずタイムアウト分を
 * 待つことになる。ここは短めのタイムアウトに抑え、正確な待ちが必要な
 * readyMarkers側で時間をかける方針にしている。
 */
export async function gotoSubscriptions(page, sel) {
  await page.goto(sel.urls.subscriptions, { waitUntil: 'domcontentloaded' });
  await settle(page);

  if (await isLoggedOut(page, sel, 600)) return { ok: false, reason: 'login' };
  if (await anyPresent(page, sel.auth.challengeMarkers, { timeout: 600 })) {
    return { ok: false, reason: 'challenge' };
  }

  // 主URLで一覧が出なければ旧URLも試す。emptyはreadyが見つかった時点で
  // 結果に影響しないため、その場合は問い合わせ自体を省略する。
  const ready = await anyPresent(page, sel.list.readyMarkers, { timeout: 6000 });
  const empty = ready ? false : await anyPresent(page, sel.list.emptyMarkers, { timeout: 800 });
  if (!ready && !empty && sel.urls.subscriptionsFallback) {
    await page.goto(sel.urls.subscriptionsFallback, { waitUntil: 'domcontentloaded' });
    await settle(page);
    if (await isLoggedOut(page, sel)) return { ok: false, reason: 'login' };
  }
  return { ok: true };
}

/**
 * 現在のページが定期おトク便の管理ページ（本来のURLかフォールバックURL）かどうか。
 * ブラウザが手動操作等で別のページに移動していると、一覧抽出が別コンテンツ
 * （おすすめ商品など）を誤って拾ってしまうため、実行前にこれで確認する。
 */
export function isSubscriptionsUrl(url, sel) {
  const samePage = (a, b) => {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      return ua.origin === ub.origin && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
    } catch {
      return false;
    }
  };
  if (samePage(url, sel.urls.subscriptions)) return true;
  if (sel.urls.subscriptionsFallback && samePage(url, sel.urls.subscriptionsFallback)) return true;
  return false;
}

export async function isLoggedOut(page, sel, timeout = 1200) {
  if (/\/ap\/signin/.test(page.url())) return true;
  return await anyPresent(page, sel.auth.loggedOutMarkers, { timeout });
}

/**
 * ネットワークが落ち着くまで待つ（Amazonは遅延描画が多いため）。
 * 実際のAmazonページは広告/おすすめウィジェットが常時通信しており"networkidle"には
 * ほぼ到達しないため、ここは短く諦めて後続の要素ポーリング(anyPresent/resolveFirst)に
 * 任せる。ここを長くしても正確性は上がらず、体感速度だけが落ちる。
 * settle()はcancel/skipの各ステップ後や一覧取得のたびに毎回呼ばれるため、
 * ここの待ち時間はそのまま操作全体の体感速度に直結する（2500ms→800msに短縮済み。
 * 2026-08-30には12000ms→2500msに短縮した経緯がある）。
 */
export async function settle(page, ms = 400) {
  await page.waitForLoadState('networkidle', { timeout: 800 }).catch(() => {});
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
    await sleep(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
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
