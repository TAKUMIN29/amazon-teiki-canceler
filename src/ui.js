import kleur from 'kleur';
import { checkbox, confirm, input, select } from '@inquirer/prompts';

const LINE = '─'.repeat(64);

/** 1件分の説明を1〜2行に組み立てる */
function lines(item) {
  const meta = [
    item.nextDelivery && `次回: ${item.nextDelivery}`,
    item.quantity && `数量: ${item.quantity}`,
    item.frequency && item.frequency,
    item.price && item.price,
  ]
    .filter(Boolean)
    .join('  ');
  return { head: truncate(item.title, 58), meta };
}

export function renderList(items) {
  if (items.length === 0) {
    console.log(kleur.yellow('\n定期おトク便の登録はありませんでした。\n'));
    return;
  }
  console.log('');
  console.log(kleur.bold(`定期おトク便 (${items.length}件)`));
  console.log(kleur.gray(LINE));
  for (const it of items) {
    const { head, meta } = lines(it);
    console.log(`${kleur.cyan(String(it.index).padStart(2))}. ${kleur.bold(head)}`);
    if (meta) console.log(`    ${kleur.gray(meta)}`);
    if (it.asin) console.log(`    ${kleur.gray('ASIN: ' + it.asin)}`);
  }
  console.log(kleur.gray(LINE));
  console.log('');
}

/** チェックボックスで対象を選ばせる */
export async function selectItems(items, actionLabel) {
  const choices = items.map((it) => {
    const { head, meta } = lines(it);
    return { name: `${String(it.index).padStart(2)}. ${head}${meta ? kleur.gray('  — ' + meta) : ''}`, value: it.index };
  });

  const picked = await checkbox({
    message: `${actionLabel}する商品を選んでください（Space=選択 / a=全選択 / Enter=決定）`,
    choices,
    pageSize: Math.min(20, Math.max(7, choices.length)),
    loop: false,
  });

  return items.filter((it) => picked.includes(it.index));
}

const ACTION_CHOICES = [
  { name: '何もしない', value: 'none' },
  { name: '次回のお届けをスキップ', value: 'skip' },
  { name: kleur.red('解約する（元に戻せません）'), value: 'cancel' },
];

/**
 * 一覧を見ながら、商品ごとに「何もしない/スキップ/解約」を選ばせる。
 * @returns {Promise<Array<{item, action:'skip'|'cancel'}>>} none を選んだ商品は含まれない
 */
export async function planActions(items) {
  const plan = [];
  for (const it of items) {
    const { head, meta } = lines(it);
    console.log('');
    console.log(`${kleur.cyan(String(it.index).padStart(2))}. ${kleur.bold(head)}`);
    if (meta) console.log(`    ${kleur.gray(meta)}`);

    const action = await select({
      message: 'この商品をどうしますか？',
      choices: ACTION_CHOICES,
      default: 'none',
    });
    if (action !== 'none') plan.push({ item: it, action });
  }
  return plan;
}

export function renderPlanSummary(plan) {
  console.log('');
  if (plan.length === 0) {
    console.log(kleur.yellow('実行する項目がありません。'));
    return;
  }
  console.log(kleur.bold(`実行予定 (${plan.length}件)`));
  console.log(kleur.gray(LINE));
  for (const { item, action } of plan) {
    const tag = action === 'cancel' ? kleur.red('解約  ') : kleur.yellow('スキップ');
    console.log(`  ${tag}  ${truncate(item.title, 52)}`);
  }
  console.log(kleur.gray(LINE));
}

/** manage コマンド用の最終確認。解約が1件でも含まれれば警告し、2件以上なら文字入力を要求する。 */
export async function confirmPlan(plan) {
  const cancelCount = plan.filter((p) => p.action === 'cancel').length;

  if (cancelCount > 0) {
    console.log('');
    console.log(kleur.red().bold('  ⚠ 解約は元に戻せません。再開するには登録し直しになります。'));
  }

  if (cancelCount >= 2) {
    console.log('');
    const answer = await input({
      message: `本当に実行する場合は ${kleur.bold('CANCEL')} と入力してください`,
    });
    if (answer.trim() !== 'CANCEL') {
      console.log(kleur.yellow('入力が一致しなかったため中止しました。'));
      return false;
    }
    return true;
  }

  console.log('');
  return await confirm({ message: '実行しますか?', default: false });
}

/** インデックス指定 "1,3,5-7" を展開する */
export function parseIndexes(spec, max) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const t = part.trim();
    if (!t) continue;
    const range = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(t)) {
      out.add(Number(t));
    } else {
      throw new Error(`--index の指定が不正です: "${t}"（例: 1,3,5-7）`);
    }
  }
  const bad = [...out].filter((i) => i < 1 || i > max);
  if (bad.length) throw new Error(`存在しない番号: ${bad.join(', ')}（1〜${max} の範囲で指定してください）`);
  return [...out].sort((a, b) => a - b);
}

/**
 * 実行前の最終確認。解約は取り返しがつかないので、全件のときは文字入力を要求する。
 */
export async function confirmRun(targets, actionLabel, { destructive, requireTyping }) {
  console.log('');
  console.log(kleur.bold(`次の ${targets.length} 件を「${actionLabel}」します:`));
  for (const t of targets) console.log(`  ${kleur.cyan('•')} ${truncate(t.title, 60)}`);
  console.log('');

  if (destructive) {
    console.log(kleur.red().bold('  ⚠ 解約は元に戻せません。再開するには登録し直しになります。'));
    console.log('');
  }

  if (requireTyping) {
    const answer = await input({
      message: `本当に実行する場合は ${kleur.bold('CANCEL')} と入力してください`,
    });
    if (answer.trim() !== 'CANCEL') {
      console.log(kleur.yellow('入力が一致しなかったため中止しました。'));
      return false;
    }
    return true;
  }

  return await confirm({ message: '実行しますか?', default: false });
}

export function renderSummary(results) {
  console.log('');
  console.log(kleur.bold('結果'));
  console.log(kleur.gray(LINE));
  for (const r of results) {
    const mark =
      r.status === 'done' ? kleur.green('✓ 完了')
      : r.status === 'done-unverified' ? kleur.yellow('△ 実行済(未確認)')
      : r.status === 'dry-run' ? kleur.blue('◇ 到達(未実行)')
      : kleur.red('✗ 失敗');
    const tag = r.action ? `${kleur.gray('[' + (r.action === 'cancel' ? '解約' : 'スキップ') + ']')} ` : '';
    console.log(`${mark}  ${tag}${truncate(r.title, 46)}`);
    if (r.message && r.status !== 'done') console.log(`        ${kleur.gray(r.message)}`);
  }
  console.log(kleur.gray(LINE));

  const n = (s) => results.filter((r) => r.status === s).length;
  const okCount = n('done') + n('done-unverified');
  const failCount = results.filter((r) => !r.ok).length;
  console.log(
    `${kleur.green(okCount + ' 件成功')}` +
      (n('dry-run') ? ` / ${kleur.blue(n('dry-run') + ' 件 dry-run')}` : '') +
      (failCount ? ` / ${kleur.red(failCount + ' 件失敗')}` : '')
  );
  console.log('');
}

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

export { kleur };
