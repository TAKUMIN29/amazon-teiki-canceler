/**
 * テスト用のニセAmazon「定期おトク便」画面。
 *
 * 2026-08-30にclaude-in-chromeで実際のamazon.co.jpにログインして確認した挙動
 * （確定ボタンは一度もクリックしていない）を再現している:
 *   - 商品カードには<a>や<button>が無く、data-edit-link/role=buttonのdivで
 *     編集モーダル(a-popover-modal)を開く。
 *   - モーダル内の「定期おトク便を停止する」でキャンセルダイアログ
 *     (#cancel-subscription-dialog, #sns-cancellation-dropdown, #confirmCancelLink)
 *     が展開する。
 *   - ページ遷移はなく、確定ボタンを押したときだけサーバへPOSTする。
 *   - ASIN/購読IDはリンクではなく data-edit-url のクエリ文字列に入っている。
 *
 *   node test/mock-amazon.js          → http://127.0.0.1:8787 で起動
 */
import http from 'node:http';
import { URL, pathToFileURL } from 'node:url';

const PORT = Number(process.env.MOCK_PORT || 8787);

const SEED = [
  { sid: 'SUB-001', asin: 'B08XYZ1234', title: 'アタック抗菌EXパワー 詰替用 1.5kg', next: '2026年9月12日', freq: '1ヵ月ごとに1ユニット' },
  { sid: 'SUB-002', asin: 'B07ABCD567', title: 'クリネックス ティシュー 5箱パック', next: '2026年9月20日', freq: '2ヵ月ごとに2ユニット' },
  { sid: 'SUB-003', asin: 'B09QWER890', title: 'サントリー天然水 550ml×24本', next: '2026年10月1日', freq: '1ヵ月ごとに1ユニット' },
  { sid: 'SUB-004', asin: 'B06TYUI234', title: 'ネスカフェ ゴールドブレンド 詰替 120g', next: '2026年10月8日', freq: '3ヵ月ごとに1ユニット' },
  { sid: 'SUB-005', asin: 'B05ZXCV678', title: 'エリエール トイレットティシュー 12ロール', next: '2026年10月15日', freq: '2ヵ月ごとに1ユニット' },
];

let subs = SEED.map((s) => ({ ...s }));
export function reset() {
  subs = SEED.map((s) => ({ ...s }));
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function card(s) {
  const editUrl = `/auto-deliveries/ajax/subscription/?subscriptionId=${encodeURIComponent(s.sid)}&subAsin=${encodeURIComponent(s.asin)}`;
  // 実物と同じく data-edit-url は「カード要素そのもの」に付く（子孫ではない）。
  // ここを子要素にしてしまうと、カード自身の属性を読めない不具合をテストで拾えなくなる。
  return `
  <div class="a-column a-span12 a-spacing-micro" data-sid="${esc(s.sid)}" data-edit-url="${esc(editUrl)}">
    <img alt="${esc(s.title)}" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
    <span class="a-size-small a-color-secondary">次回の配達日: ${esc(s.next)}</span>
    <span class="a-size-small a-color-secondary">${esc(s.freq)}</span>
    <div role="button" tabindex="0" data-edit-link="true" data-sid="${esc(s.sid)}">
      <span class="a-size-small a-color-link">編集</span>
    </div>
  </div>`;
}

/**
 * 実際のAmazon画面で見つかった不具合の再現用: 定期おトク便とは無関係な
 * 「おすすめ商品」枠。img[alt]や商品リンク、「配送」等の単語を含むため、
 * 緩いヒューリスティックだけだと定期おトク便のカードと誤認してしまう。
 * data-edit-link（編集トリガー）は持たない — 本物のカードとの決定的な違い。
 */
function promoCard() {
  return `
  <div class="a-carousel-card">
    <img alt="Kindle Paperwhite シグニチャーエディション" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
    <span class="a-size-small a-color-secondary">過去1か月で2000点以上購入されました　配送料無料</span>
    <a class="a-link-normal" href="/dp/B0FAKE1234">￥32,980</a>
  </div>`;
}

function pageHtml(banner, plain, promo) {
  const cards = subs.map(card).join('\n');
  const promoBlock = promo ? promoCard() : '';
  // plain=true: コンテナのid/構造だけをリニューアルした想定（操作に必要なdata属性は残す）
  const gridOpen = plain ? '<div class="subs-grid">' : '<div id="subscriptionsDesktopGridLayout">';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>配達を管理</title>
<style>
body{font-family:sans-serif;margin:24px;max-width:1000px}
#subscriptionsDesktopGridLayout, .subs-grid{display:flex;flex-wrap:wrap;gap:16px}
#subscriptionsDesktopGridLayout > div, .subs-grid > div{border:1px solid #ddd;border-radius:8px;padding:12px;width:260px}
img{width:60px;height:60px;background:#eee;display:block}
[role=button]{cursor:pointer;margin-top:8px}
.a-popover-modal{position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #888;
  border-radius:8px;padding:16px;width:420px;box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:1000}
.a-popover-modal[aria-hidden="true"]{display:none}
.a-button{display:inline-block;padding:8px 16px;border-radius:20px;background:#fff;border:1px solid #888;cursor:pointer;margin-top:8px}
.a-button-primary{background:#f0c14b;border-color:#a88734}
#banner{background:#e6f4ea;padding:10px;border-radius:6px;margin:12px 0}
</style></head><body>
<div id="nav-link-accountList">アカウント＆リスト</div>
<h1>定期おトク便</h1>
${banner ? `<div id="banner">${esc(banner)}</div>` : ''}
${promo ? `<h2>おすすめの商品</h2><div class="promo-row">${promoBlock}</div>` : ''}
${subs.length === 0
    ? '<p>定期おトク便の登録はありません</p>'
    : `<h2>ご利用のサブスクリプション</h2>${gridOpen}${cards}</div>`}

<script>
const CANCEL_REASONS = [
  { value: '', label: '解約の理由を選択' },
  { value: 'SnS_MYD_SnsCancelReason_sns_cancel_reason_no_more_needed', label: 'もう必要なくなった' },
  { value: 'SnS_MYD_SnsCancelReason_sns_cancel_reason_stopped_using', label: '商品を使うのをやめた' },
  { value: 'SnS_MYD_SnsCancelReason_sns_cancel_reason_need_sooner', label: 'すぐ商品が必要になった' },
];

function closeAllModals() {
  document.querySelectorAll('.a-popover-modal').forEach((m) => m.remove());
}

function openEditModal(sid) {
  closeAllModals();
  const modal = document.createElement('div');
  modal.className = 'a-popover-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'false');
  modal.innerHTML = [
    '<button data-action="a-popover-close">×</button>',
    '<h4>サブスクリプションの詳細</h4>',
    '<div><a class="a-link-normal stop-link">定期おトク便を停止する</a></div>',
    '<div id="cancel-subscription-dialog" style="display:none">',
    '  <h1 id="cancel-subscription-title">定期おトク便をキャンセルしますか？</h1>',
    '  <select id="sns-cancellation-dropdown"></select>',
    '  <br>',
    '  <span class="a-button a-button-primary wideButton" id="confirmCancelLink"><span class="a-button-text">登録をキャンセルする</span></span>',
    '</div>',
  ].join('');
  document.body.appendChild(modal);

  const select = modal.querySelector('#sns-cancellation-dropdown');
  for (const r of CANCEL_REASONS) {
    const opt = document.createElement('option');
    opt.value = r.value;
    opt.textContent = r.label;
    select.appendChild(opt);
  }

  modal.querySelector('[data-action="a-popover-close"]').addEventListener('click', closeAllModals);
  modal.querySelector('.stop-link').addEventListener('click', () => {
    modal.querySelector('#cancel-subscription-dialog').style.display = 'block';
  });
  modal.querySelector('#confirmCancelLink').addEventListener('click', async () => {
    if (!select.value) { console.log('理由が未選択です'); return; }
    const res = await fetch('/auto-deliveries/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'sid=' + encodeURIComponent(sid) + '&reason=' + encodeURIComponent(select.value),
    });
    if (res.ok) location.href = '/auto-deliveries?msg=' + encodeURIComponent('定期おトク便をキャンセルしました');
  });
}

document.querySelectorAll('[data-edit-link="true"]').forEach((el) => {
  el.addEventListener('click', () => openEditModal(el.dataset.sid));
});
</script>
</body></html>`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const send = (html, code = 200) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    };

    if (url.pathname === '/__reset') {
      reset();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, count: subs.length }));
    }
    if (url.pathname === '/__state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(subs));
    }

    if (url.pathname === '/auto-deliveries' && req.method === 'GET') {
      const plain = url.searchParams.get('mode') === 'plain';
      const promo = url.searchParams.get('promo') === '1';
      return send(pageHtml(url.searchParams.get('msg'), plain, promo));
    }
    if (url.pathname === '/auto-deliveries/cancel' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.get('reason')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'reason required' }));
      }
      subs = subs.filter((s) => s.sid !== b.get('sid'));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    send('<p>not found</p>', 404);
  });
}

// 直接実行されたときだけサーバを起動する（他ファイルからimportされたときは起動しない）。
// 自前で "file://" を組み立てるとWindowsでドライブレターの前のスラッシュ数が合わず
// 判定が常にfalseになるため、pathToFileURLで正規化して比較する。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`mock amazon: http://127.0.0.1:${PORT}/auto-deliveries`);
  });
}
