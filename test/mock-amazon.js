/**
 * テスト用のニセAmazon「定期おトク便」画面。
 *
 * 本物のDOMは見られないので、代わりに「ありがちな入れ子の深さ・遅延描画・
 * 折りたたみパネル・キャンセル理由の選択」を再現した画面を立てて、
 * 抽出ロジックと操作ロジックを通しで検証する。
 *
 *   node test/mock-amazon.js          → http://127.0.0.1:8787 で起動
 *   /auto-deliveries?mode=rich        → data-subscription-id 付き（設定セレクタ経路）
 *   /auto-deliveries?mode=plain       → 目印なし（ヒューリスティック経路）
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.MOCK_PORT || 8787);

const SEED = [
  { sid: 'SUB-001', asin: 'B08XYZ1234', title: 'アタック抗菌EXパワー 詰替用 1.5kg', next: '2026年9月12日', qty: '1', freq: '1か月ごとに配送', price: '￥1,180' },
  { sid: 'SUB-002', asin: 'B07ABCD567', title: 'クリネックス ティシュー 5箱パック', next: '2026年9月20日', qty: '2', freq: '2か月ごとに配送', price: '￥1,540' },
  { sid: 'SUB-003', asin: 'B09QWER890', title: 'サントリー天然水 550ml×24本', next: '2026年10月1日', qty: '1', freq: '1か月ごとに配送', price: '￥1,880' },
  { sid: 'SUB-004', asin: 'B06TYUI234', title: 'ネスカフェ ゴールドブレンド 詰替 120g', next: '2026年10月8日', qty: '3', freq: '3か月ごとに配送', price: '￥2,240' },
  { sid: 'SUB-005', asin: 'B05ZXCV678', title: 'エリエール トイレットティシュー 12ロール', next: '2026年10月15日', qty: '1', freq: '2か月ごとに配送', price: '￥1,320' },
];

let subs = SEED.map((s) => ({ ...s, skipped: false }));
export function reset() {
  subs = SEED.map((s) => ({ ...s, skipped: false }));
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function card(s, mode) {
  // rich: 本物同様に data-subscription-id が付く / plain: 何の目印もない
  const attrs =
    mode === 'plain'
      ? 'class="a-box-group"'
      : `class="a-box-group" id="subscription-card-${esc(s.sid)}" data-subscription-id="${esc(s.sid)}"`;

  return `
  <div ${attrs}>
   <div class="a-box"><div class="a-box-inner"><div class="a-row">
    <div class="a-column a-span2">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="${esc(s.title)}">
    </div>
    <div class="a-column a-span7">
      <a class="a-link-normal" href="/dp/${esc(s.asin)}/ref=teiki"><span class="a-text-bold">${esc(s.title)}</span></a>
      <div class="a-row a-size-small">
        <span class="a-color-secondary">次回のお届け</span>
        <span class="a-text-bold">${esc(s.next)}</span>
      </div>
      <div class="a-row a-size-small">
        <span class="a-color-secondary">数量</span>
        <select name="quantity-${esc(s.sid)}" id="quantity-${esc(s.sid)}">
          <option value="${esc(s.qty)}" selected>${esc(s.qty)}</option>
        </select>
        <span class="a-color-secondary">${esc(s.freq)}</span>
      </div>
      <div class="a-row"><span class="a-price"><span class="a-offscreen">${esc(s.price)}</span></span></div>
      ${s.skipped ? '<div class="a-row a-color-success">次回のお届けをスキップ済み</div>' : ''}
    </div>
    <div class="a-column a-span3">
      <a class="a-expander-prompt" href="javascript:void(0)" data-sid="${esc(s.sid)}">定期おトク便の設定を変更</a>
      <div class="a-expander-content" id="panel-${esc(s.sid)}" style="display:none">
        <form method="post" action="/auto-deliveries/skip">
          <input type="hidden" name="sid" value="${esc(s.sid)}">
          <button type="submit" class="a-button-text">次回のお届けをスキップ</button>
        </form>
        <a class="a-link-normal" href="/auto-deliveries/cancel?sid=${esc(s.sid)}">定期おトク便をキャンセル</a>
      </div>
    </div>
   </div></div></div>
  </div>`;
}

function listPage(mode, banner) {
  const body = subs.map((s) => card(s, mode)).join('\n');
  return page(
    '定期おトク便の管理',
    `
    <div id="nav-link-accountList">アカウント＆リスト</div>
    <h1>定期おトク便</h1>
    ${banner ? `<div class="a-alert-success" id="banner">${esc(banner)}</div>` : ''}
    ${subs.length === 0 ? '<p>定期おトク便の登録はありません</p>' : `<div id="list-root">${body}</div>`}
    <script>
      // 本物と同じく、折りたたみパネルはクリックで開く
      document.querySelectorAll('.a-expander-prompt').forEach(function (a) {
        a.addEventListener('click', function () {
          var p = document.getElementById('panel-' + a.dataset.sid);
          p.style.display = p.style.display === 'none' ? 'block' : 'none';
        });
      });
    </script>`
  );
}

function cancelPage(sid) {
  const s = subs.find((x) => x.sid === sid);
  if (!s) return page('エラー', '<p>該当する定期おトク便が見つかりません</p>');
  return page(
    '定期おトク便のキャンセル',
    `
    <div id="nav-link-accountList">アカウント＆リスト</div>
    <h1>定期おトク便をキャンセル</h1>
    <p>${esc(s.title)} の定期おトク便をキャンセルします。</p>
    <form method="post" action="/auto-deliveries/cancel/confirm">
      <input type="hidden" name="sid" value="${esc(sid)}">
      <label for="cancelReason">キャンセルの理由をお選びください</label>
      <select name="cancelReason" id="cancelReason" required>
        <option value="">選択してください</option>
        <option value="r1">価格が高い</option>
        <option value="r2">十分な在庫がある</option>
        <option value="r3">商品が必要なくなった</option>
        <option value="r4">その他</option>
      </select>
      <button type="submit">定期おトク便をキャンセル</button>
      <a href="/auto-deliveries">戻る</a>
    </form>`
  );
}

function page(title, inner) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:sans-serif;margin:24px;max-width:1000px}
.a-box-group{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}
.a-row{margin:4px 0}.a-column{display:inline-block;vertical-align:top;margin-right:16px}
.a-alert-success{background:#e6f4ea;padding:10px;border-radius:6px;margin:12px 0}
img{width:60px;height:60px;background:#eee}</style></head><body>${inner}</body></html>`;
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
    const redirect = (to) => {
      res.writeHead(302, { location: to });
      res.end();
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
      const mode = url.searchParams.get('mode') === 'plain' ? 'plain' : 'rich';
      return send(listPage(mode, url.searchParams.get('msg')));
    }
    if (url.pathname === '/auto-deliveries/cancel' && req.method === 'GET') {
      return send(cancelPage(url.searchParams.get('sid')));
    }
    if (url.pathname === '/auto-deliveries/cancel/confirm' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.get('cancelReason')) return send(page('エラー', '<p>理由が未選択です</p>'), 400);
      subs = subs.filter((s) => s.sid !== b.get('sid'));
      return redirect('/auto-deliveries?msg=' + encodeURIComponent('定期おトク便をキャンセルしました'));
    }
    if (url.pathname === '/auto-deliveries/skip' && req.method === 'POST') {
      const b = await readBody(req);
      const s = subs.find((x) => x.sid === b.get('sid'));
      if (s) s.skipped = true;
      return redirect('/auto-deliveries?msg=' + encodeURIComponent('次回のお届けをスキップされました'));
    }
    send(page('404', '<p>not found</p>'), 404);
  });
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`mock amazon: http://127.0.0.1:${PORT}/auto-deliveries`);
  });
}
