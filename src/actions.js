import { resolveFirst, anyPresent, sleep, clean } from './locator.js';
import { settle, dump } from './browser.js';

/**
 * 設定ファイルの steps を順に実行する。
 *
 * dryRun=true のとき、pointOfNoReturn が立ったステップは「押せる状態か」だけ確認して
 * 実際にはクリックしない。つまり本番と同じ導線を最後の一歩手前までなぞる。
 *
 * @returns {Promise<{ok:boolean, status:string, message:string, trace:Array}>}
 */
export async function runSteps(page, item, flow, { dryRun = false, log = () => {} } = {}) {
  const trace = [];

  for (const step of flow.steps) {
    const roots = rootsForScope(page, item, step.scope);
    let hit = null;
    let usedScope = null;

    for (const { name, root } of roots) {
      hit = await resolveFirst(root, step.target, { timeout: step.optional ? 2500 : 8000 });
      if (hit) {
        usedScope = name;
        break;
      }
    }

    if (!hit) {
      if (step.optional) {
        trace.push({ step: step.description, result: 'skipped(見つからないが任意)' });
        log(`    - ${step.description} … 見つからず（任意なので続行）`);
        continue;
      }
      const path = await dump(page, `fail-${flow.label}`);
      trace.push({ step: step.description, result: 'not-found' });
      return {
        ok: false,
        status: 'not-found',
        message: `「${step.description}」の要素が見つかりませんでした。画面を ${path}.png / .html に保存しました。config/selectors.json の候補を追加してください。`,
        trace,
      };
    }

    const label = describe(hit.spec);

    if (dryRun && step.pointOfNoReturn) {
      trace.push({ step: step.description, result: 'dry-run-stop', matched: label });
      log(`    - ${step.description} … 発見: ${label} 【dry-run のためここで停止】`);
      return { ok: true, status: 'dry-run', message: `最終ボタン「${label}」まで到達（未実行）`, trace };
    }

    try {
      if (step.action === 'chooseReason') {
        const chosen = await chooseReason(hit.locator, flow.reasonPreference ?? []);
        trace.push({ step: step.description, result: 'ok', matched: label, value: chosen });
        log(`    - ${step.description} … 「${chosen ?? '既定値'}」を選択`);
      } else {
        await hit.locator.scrollIntoViewIfNeeded().catch(() => {});
        await hit.locator.click({ timeout: 10000 });
        trace.push({ step: step.description, result: 'ok', matched: label, scope: usedScope });
        log(`    - ${step.description} … クリック: ${label}`);
      }
    } catch (e) {
      const path = await dump(page, `error-${flow.label}`);
      trace.push({ step: step.description, result: 'click-failed', matched: label });
      return {
        ok: false,
        status: 'click-failed',
        message: `「${step.description}」のクリックに失敗: ${e.message.split('\n')[0]} / 画面を ${path}.png に保存`,
        trace,
      };
    }

    await sleep(step.waitAfter ?? 1000);
    await settle(page, 400);
  }

  if (dryRun) {
    return { ok: true, status: 'dry-run', message: '全ステップ到達（未実行）', trace };
  }

  const confirmed = await anyPresent(page, flow.successMarkers ?? [], { timeout: 3000 });
  return {
    ok: true,
    status: confirmed ? 'done' : 'done-unverified',
    message: confirmed ? '完了（成功メッセージを確認）' : '完了（成功メッセージは確認できず。後で一覧を再確認してください）',
    trace,
  };
}

/** scope 指定を、実際に探索する root の並びへ変換する */
function rootsForScope(page, item, scope) {
  const card = item?.cardSelector ? page.locator(item.cardSelector) : null;
  switch (scope) {
    case 'card':
      return card ? [{ name: 'card', root: card }] : [{ name: 'page', root: page }];
    case 'page':
      return [{ name: 'page', root: page }];
    case 'cardThenPage':
    default:
      return card ? [{ name: 'card', root: card }, { name: 'page', root: page }] : [{ name: 'page', root: page }];
  }
}

/** キャンセル理由の select / radio を、優先順位に従って選ぶ */
async function chooseReason(locator, preferences) {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

  if (tag === 'select') {
    const options = await locator.evaluate((el) =>
      Array.from(el.options).map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
    );
    const usable = options.filter((o) => o.value && !/^(|0|-1)$/.test(o.value));
    const pick =
      usable.find((o) => preferences.some((p) => o.label.includes(p))) ?? usable[usable.length - 1] ?? null;
    if (!pick) return null;
    await locator.selectOption(pick.value);
    return pick.label || pick.value;
  }

  // radio の場合: 同名グループの中から優先順位に合うものを選ぶ
  const name = await locator.getAttribute('name').catch(() => null);
  const group = name ? locator.page().locator(`input[type='radio'][name='${cssEscape(name)}']`) : locator;
  const n = await group.count();
  let fallback = null;

  for (let i = 0; i < n; i++) {
    const radio = group.nth(i);
    const label = clean(
      await radio.evaluate((el) => {
        const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
        return (byFor?.textContent || el.closest('label')?.textContent || el.parentElement?.textContent || '').trim();
      }).catch(() => '')
    );
    if (fallback === null) fallback = { radio, label };
    if (label && preferences.some((p) => label.includes(p))) {
      await radio.check({ force: true });
      return label;
    }
  }
  if (fallback) {
    await fallback.radio.check({ force: true });
    return fallback.label;
  }
  return null;
}

/** 属性セレクタに埋め込むため、引用符とバックスラッシュを退避する */
function cssEscape(s) {
  const bs = String.fromCharCode(92);
  const specials = new Set([bs, String.fromCharCode(34), String.fromCharCode(39)]);
  return Array.from(String(s))
    .map((c) => (specials.has(c) ? bs + c : c))
    .join("");
}

function describe(spec) {
  if (spec.role) return `${spec.role}[name="${spec.name}"]`;
  if (spec.text) return `text="${spec.text}"`;
  if (spec.css) return `css=${spec.css}`;
  if (spec.xpath) return `xpath=${spec.xpath}`;
  return JSON.stringify(spec);
}
