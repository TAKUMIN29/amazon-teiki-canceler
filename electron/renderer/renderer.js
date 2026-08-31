const screens = {
  loading: document.getElementById('screen-loading'),
  login: document.getElementById('screen-login'),
  challenge: document.getElementById('screen-challenge'),
  launchError: document.getElementById('screen-launch-error'),
  list: document.getElementById('screen-list'),
  progress: document.getElementById('screen-progress'),
  result: document.getElementById('screen-result'),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

/** items: getList() で取得した最新の一覧 */
let items = [];
/** key(item) -> 'none' | 'cancel' */
const actions = new Map();

function keyOf(item) {
  return item.asin ?? item.subscriptionId ?? item.title;
}

/**
 * 「ブラウザを表示しない」設定。ONだと画面を出さずに裏で操作するので速いが、
 * Amazonに自動操作と判定されやすくなる可能性があるため既定はOFF。
 * ログイン時は認証操作が必要なので、この設定に関わらず必ず表示される。
 */
function isHeadless() {
  return document.getElementById('headless-checkbox').checked;
}

// 設定はこのパソコンのこのアプリ内にだけ残す（次回起動時も選択を覚えておく）
try {
  const saved = localStorage.getItem('teiki:headless');
  if (saved === '1') document.getElementById('headless-checkbox').checked = true;
} catch {
  /* プライベートウィンドウ等で使えなくても既定値で動く */
}
document.getElementById('headless-checkbox').addEventListener('change', (e) => {
  try {
    localStorage.setItem('teiki:headless', e.target.checked ? '1' : '0');
  } catch {
    /* 保存できなくても動作には影響しない */
  }
  // モードが変わるとブラウザを開き直す必要があるため、一覧を取り直す
  refreshList();
});

/* ------------------------------------------------------------ 起動〜一覧取得 */

async function refreshList() {
  showScreen('loading');
  const r = await window.teiki.getList({ headless: isHeadless() });

  if (!r.ok) {
    if (r.reason === 'login') return showScreen('login');
    if (r.reason === 'challenge') return showScreen('challenge');
    return showLaunchError(r);
  }

  items = r.items;
  actions.clear();
  for (const it of items) actions.set(keyOf(it), 'none');

  document.getElementById('list-strategy').textContent = `${items.length}件（抽出方法: ${r.strategy}）`;
  document.getElementById('list-empty').hidden = items.length > 0;
  renderItemList();
  showScreen('list');
}

function showLaunchError(r) {
  const titleEl = document.getElementById('launch-error-title');
  const msgEl = document.getElementById('launch-error-message');
  const dlBtn = document.getElementById('btn-download-chrome');

  if (r.kind === 'chrome-missing') {
    titleEl.textContent = 'Google Chromeが見つかりませんでした';
    msgEl.textContent =
      'このアプリはお使いのパソコンにインストールされているGoogle Chromeを使って動作します。' +
      'まだインストールされていない場合は、下のボタンからインストールしてから、もう一度お試しください。';
    dlBtn.hidden = false;
  } else if (r.kind === 'profile-in-use') {
    titleEl.textContent = 'ブラウザが起動できませんでした';
    msgEl.textContent =
      'このアプリが前回開いたブラウザのウィンドウが、まだ残っている可能性があります。' +
      '該当するウィンドウを閉じてから、もう一度お試しください。';
    dlBtn.hidden = true;
  } else {
    titleEl.textContent = 'ブラウザを起動できませんでした';
    msgEl.textContent = r.message ?? '原因不明のエラーが発生しました。もう一度お試しください。';
    dlBtn.hidden = true;
  }
  showScreen('launchError');
}

/* ------------------------------------------------------------------- ログイン */

document.getElementById('btn-start-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-start-login');
  const statusEl = document.getElementById('login-status');
  btn.disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = 'ブラウザを開いています…';

  const r = await window.teiki.startLogin();
  btn.disabled = false;

  if (r.ok) {
    statusEl.textContent = 'ログインを確認しました。';
    await refreshList();
  } else if (r.timeout) {
    statusEl.textContent = 'タイムアウトしました。もう一度お試しください。';
  } else if (r.reason === 'launch-failed') {
    showLaunchError(r);
  } else {
    statusEl.textContent = '中断しました。もう一度お試しください。';
  }
});

window.teiki.onLoginStatus((status) => {
  const statusEl = document.getElementById('login-status');
  if (statusEl.hidden) return;
  if (status.state === 'waiting') statusEl.textContent = 'ログイン待機中…（開いたブラウザでログインしてください）';
});

document.getElementById('btn-recheck-challenge').addEventListener('click', refreshList);
document.getElementById('btn-retry-launch').addEventListener('click', async () => {
  await window.teiki.resetBrowser();
  await refreshList();
});
document.getElementById('btn-download-chrome').addEventListener('click', () => {
  window.teiki.openChromeDownload();
});

/* --------------------------------------------------------------------- 一覧 */

function itemMeta(it) {
  return [
    it.nextDelivery && `次回: ${it.nextDelivery}`,
    it.quantity && `数量: ${it.quantity}`,
    it.frequency,
    it.price,
  ].filter(Boolean).join('　');
}

function renderItemList() {
  const query = document.getElementById('search-box').value.trim().toLowerCase();
  const container = document.getElementById('item-list');
  container.innerHTML = '';

  const visible = items.filter((it) => !query || (it.title ?? '').toLowerCase().includes(query));

  for (const it of visible) {
    const key = keyOf(it);
    const current = actions.get(key) ?? 'none';

    const card = document.createElement('div');
    card.className = 'item-card';

    const info = document.createElement('div');
    info.innerHTML = `<p class="item-title"></p><p class="item-meta"></p>`;
    info.querySelector('.item-title').textContent = it.title;
    info.querySelector('.item-meta').textContent = itemMeta(it);
    card.appendChild(info);

    const choices = document.createElement('div');
    choices.className = 'action-choices';
    choices.appendChild(makeChoice(key, 'none', '何もしない', current));
    choices.appendChild(makeChoice(key, 'cancel', '解約する', current));
    card.appendChild(choices);

    container.appendChild(card);
  }

  updateSelectionSummary();
}

function makeChoice(key, value, label, current) {
  const el = document.createElement('label');
  el.className = `choice-${value}${current === value ? ' active' : ''}`;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = `action-${key}`;
  input.checked = current === value;
  input.addEventListener('change', () => {
    actions.set(key, value);
    renderItemList();
  });
  const span = document.createElement('span');
  span.textContent = label;
  el.appendChild(input);
  el.appendChild(span);
  return el;
}

function updateSelectionSummary() {
  let cancelCount = 0;
  for (const v of actions.values()) {
    if (v === 'cancel') cancelCount++;
  }
  document.getElementById('selection-summary').textContent = `解約 ${cancelCount}件が選択されています`;
  document.getElementById('btn-open-confirm').disabled = cancelCount === 0;
}

document.getElementById('search-box').addEventListener('input', renderItemList);
document.getElementById('btn-refresh-list').addEventListener('click', refreshList);

/* ------------------------------------------------------------------ 確認モーダル */

const modalConfirm = document.getElementById('modal-confirm');

document.getElementById('btn-open-confirm').addEventListener('click', openConfirmModal);

function openConfirmModal() {
  const entries = items
    .filter((it) => (actions.get(keyOf(it)) ?? 'none') !== 'none')
    .map((it) => ({ asin: it.asin, subscriptionId: it.subscriptionId, title: it.title, action: actions.get(keyOf(it)) }));

  const listEl = document.getElementById('confirm-list');
  listEl.innerHTML = '';
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = `action-${e.action}`;
    li.textContent = `解約 — ${e.title}`;
    listEl.appendChild(li);
  }

  const cancelCount = entries.filter((e) => e.action === 'cancel').length;
  const warningEl = document.getElementById('confirm-warning');
  const typingWrap = document.getElementById('confirm-typing');
  const typingInput = document.getElementById('confirm-typing-input');
  const runBtn = document.getElementById('btn-confirm-run');

  warningEl.hidden = cancelCount === 0;
  typingWrap.hidden = cancelCount < 2;
  typingInput.value = '';

  if (cancelCount >= 2) {
    runBtn.disabled = true;
  } else {
    runBtn.disabled = false;
  }

  modalConfirm.dataset.entries = JSON.stringify(entries);
  modalConfirm.hidden = false;
}

document.getElementById('confirm-typing-input').addEventListener('input', (e) => {
  document.getElementById('btn-confirm-run').disabled = e.target.value.trim() !== 'CANCEL';
});

document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
  modalConfirm.hidden = true;
});

document.getElementById('btn-confirm-run').addEventListener('click', async () => {
  const entries = JSON.parse(modalConfirm.dataset.entries || '[]');
  const dryRun = document.getElementById('dryrun-checkbox').checked;
  modalConfirm.hidden = true;
  await runPlan(entries, dryRun);
});

/* -------------------------------------------------------------------- 実行 */

async function runPlan(entries, dryRun) {
  showScreen('progress');
  const logEl = document.getElementById('progress-log');
  const currentEl = document.getElementById('progress-current');
  const backBtn = document.getElementById('btn-progress-back');
  logEl.innerHTML = '';
  currentEl.textContent = '';
  currentEl.classList.remove('warning-text');
  backBtn.hidden = true;

  const r = await window.teiki.runPlan(entries, dryRun, isHeadless());

  if (!r.ok) {
    currentEl.classList.add('warning-text');
    if (r.reason === 'wrong-page') {
      currentEl.textContent =
        'ブラウザが定期おトク便の管理ページとは別のページに移動しているため、実行を中止しました。' +
        '操作は何も行われていません。ブラウザの画面を確認し、一覧を開き直してから、もう一度お試しください。';
      const li = document.createElement('li');
      li.className = 'step';
      li.textContent = `現在のページ: ${r.currentUrl}`;
      logEl.appendChild(li);
    } else {
      currentEl.textContent = `エラーが発生しました: ${r.message}`;
    }
    backBtn.hidden = false;
    return;
  }
  renderResult(r.results, r.logFile);
}

window.teiki.onRunProgress((ev) => {
  const logEl = document.getElementById('progress-log');
  const currentEl = document.getElementById('progress-current');

  if (ev.type === 'item-start') {
    const label = '解約';
    currentEl.textContent = `[${ev.index + 1}/${ev.total}] ${label} — ${ev.title}`;
    const li = document.createElement('li');
    li.textContent = `[${ev.index + 1}/${ev.total}] ${label} — ${ev.title}`;
    logEl.appendChild(li);
  } else if (ev.type === 'step') {
    const li = document.createElement('li');
    li.className = 'step';
    li.textContent = ev.message;
    logEl.appendChild(li);
  } else if (ev.type === 'item-done') {
    const li = document.createElement('li');
    li.className = 'step';
    li.textContent = `→ ${ev.message}`;
    logEl.appendChild(li);
  }
  logEl.scrollTop = logEl.scrollHeight;
});

/* -------------------------------------------------------------------- 結果 */

const STATUS_MARK = {
  done: { cls: 'mark-done', symbol: '✓' },
  'done-unverified': { cls: 'mark-unverified', symbol: '△' },
  'dry-run': { cls: 'mark-dryrun', symbol: '◇' },
};

function renderResult(results, logFile) {
  const okCount = results.filter((r) => r.status === 'done' || r.status === 'done-unverified').length;
  const dryCount = results.filter((r) => r.status === 'dry-run').length;
  const failCount = results.filter((r) => !r.ok).length;

  const parts = [`${okCount} 件成功`];
  if (dryCount) parts.push(`${dryCount} 件 dry-run`);
  if (failCount) parts.push(`${failCount} 件失敗`);
  document.getElementById('result-summary').textContent = parts.join(' / ');

  const listEl = document.getElementById('result-list');
  listEl.innerHTML = '';
  for (const r of results) {
    const mark = STATUS_MARK[r.status] ?? { cls: 'mark-fail', symbol: '✗' };
    const li = document.createElement('li');
    const label = r.action ? '[解約] ' : '';
    li.innerHTML = `<span class="mark ${mark.cls}">${mark.symbol}</span>${label}${escapeHtml(r.title)}`;
    if (r.message && r.status !== 'done') {
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = r.message;
      li.appendChild(msg);
    }
    listEl.appendChild(li);
  }

  document.getElementById('result-log-path').textContent = logFile ? `ログ: ${logFile}` : '';
  showScreen('result');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

document.getElementById('btn-back-to-list').addEventListener('click', refreshList);
document.getElementById('btn-progress-back').addEventListener('click', refreshList);
document.getElementById('btn-open-out-folder').addEventListener('click', () => window.teiki.openOutFolder());
document.getElementById('btn-open-logs-folder').addEventListener('click', () => window.teiki.openLogsFolder());

/* ------------------------------------------------------------------ 終了確認 */

const modalClose = document.getElementById('modal-close');
window.teiki.onCloseRequested(() => { modalClose.hidden = false; });
document.getElementById('btn-close-cancel').addEventListener('click', () => { modalClose.hidden = true; });
document.getElementById('btn-close-force').addEventListener('click', () => { window.teiki.forceQuit(); });

/* --------------------------------------------------------------------- 起動 */

refreshList();
