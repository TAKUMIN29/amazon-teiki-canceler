import { resolveFirst, readValue, clean } from './locator.js';
import { scrollToBottom, settle, anyPresent } from './browser.js';

/**
 * ページ内で定期おトク便のカードを特定し、data-teiki-card="N" を打つ。
 * 設定セレクタで見つからない場合は、商品リンクから祖先をたどるヒューリスティックに落ちる。
 * @returns {Promise<{count:number, strategy:string}>}
 */
async function markCards(page, cardSpecs, editTriggerSpecs) {
  const cssCandidates = cardSpecs.filter((s) => s.css).map((s) => s.css);
  // 定期おトク便のカードには必ず「編集」トリガー要素がある。おすすめ商品の
  // カルーセルなど無関係なブロックは、商品リンク/画像や「配送」等の単語を
  // 含んでいても編集トリガーは持たないため、これを必須条件にして誤検出を防ぐ。
  const editTriggerCss = (editTriggerSpecs ?? []).filter((s) => s.css).map((s) => s.css);

  return await page.evaluate(({ cssList, editTriggerCssList }) => {
    document.querySelectorAll('[data-teiki-card]').forEach((el) => el.removeAttribute('data-teiki-card'));

    const hasEditTrigger = (el) => {
      if (editTriggerCssList.length === 0) return true; // 設定が無ければ従来通り
      return editTriggerCssList.some((css) => {
        try {
          return !!el.querySelector(css);
        } catch {
          return false;
        }
      });
    };

    const looksLikeCard = (el) => {
      if (!el || !el.querySelector) return false;
      const t = el.innerText || '';
      const hasProduct = !!el.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], img');
      const hasSubWords = /定期|お届け|スキップ|キャンセル|配送|配達/.test(t);
      return hasProduct && hasSubWords && hasEditTrigger(el) && t.length > 15 && t.length < 4000;
    };

    // --- 戦略1: 設定ファイルのCSSセレクタ ---
    for (const css of cssList) {
      let els;
      try {
        els = Array.from(document.querySelectorAll(css));
      } catch {
        continue;
      }
      const good = els.filter(looksLikeCard);
      if (good.length > 0) {
        good.forEach((el, i) => el.setAttribute('data-teiki-card', String(i)));
        return { count: good.length, strategy: `css:${css}` };
      }
    }

    // --- 戦略2: 商品ごとに一意な要素（dpリンク／img[alt]）の祖先をたどる ---
    // Amazonの新UI(2026年時点)ではカードに<a>が無く、img[alt]しか手がかりが無いことがある。
    // ページ内のどこか（おすすめ商品など）にdpリンクが1つでもあると、
    // 以前はそれだけでページ全体の戦略が「img[alt]」から「dpリンク」に切り替わってしまい、
    // 本来<a>を持たない定期おトク便のカードが1件も見つからなくなる問題があった。
    // そのため、両方の候補群それぞれで祖先探索を行い、結果をマージする。
    const asinOf = (href) => (href.match(/\/(?:dp|product)\/([A-Z0-9]{10})/) || [])[1] || null;

    function collect(uniqueSelector, keyOf, entries) {
      const found = [];
      for (const anchor of entries) {
        let node = anchor;
        let best = null;
        for (let depth = 0; depth < 12 && node.parentElement; depth++) {
          node = node.parentElement;
          if (node === document.body) break;
          // 別商品まで巻き込んだら、その手前で止める
          const keysInNode = new Set(
            Array.from(node.querySelectorAll(uniqueSelector)).map(keyOf).filter(Boolean)
          );
          if (keysInNode.size > 1) break;
          if (looksLikeCard(node)) best = node;
        }
        if (best) found.push(best);
      }
      return found;
    }

    const dpAnchors = Array.from(document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]'));
    const dpKeyOf = (el) => asinOf(el.getAttribute('href') || '');
    const dpByKey = new Map();
    for (const a of dpAnchors) {
      const k = dpKeyOf(a);
      if (!k || dpByKey.has(k)) continue;
      dpByKey.set(k, a);
    }
    const dpCards = collect('a[href*="/dp/"], a[href*="/gp/product/"]', dpKeyOf, Array.from(dpByKey.values()));

    const imgKeyOf = (el) => (el.getAttribute('alt') || '').trim() || null;
    const imgByKey = new Map();
    for (const img of document.querySelectorAll('img[alt]')) {
      const k = imgKeyOf(img);
      if (!k || k.length < 4 || imgByKey.has(k)) continue;
      imgByKey.set(k, img);
    }
    const imgCards = collect('img[alt]', imgKeyOf, Array.from(imgByKey.values()));

    const cards = [];
    let usedStrategies = [];
    for (const [label, found] of [['anchor', dpCards], ['img-alt', imgCards]]) {
      let added = 0;
      for (const best of found) {
        if (cards.some((c) => c.contains(best) || best.contains(c))) continue;
        cards.push(best);
        added++;
      }
      if (added > 0) usedStrategies.push(label);
    }

    cards.forEach((el, i) => el.setAttribute('data-teiki-card', String(i)));
    return { count: cards.length, strategy: `heuristic:${usedStrategies.join('+') || 'none'}-ancestor` };
  }, { cssList: cssCandidates, editTriggerCssList: editTriggerCss });
}

/** カード要素から購読IDらしきものを拾う */
async function readSubscriptionId(cardLoc, idAttrs) {
  for (const attr of idAttrs) {
    const v = await cardLoc.getAttribute(attr).catch(() => null);
    if (v && /[A-Za-z0-9]/.test(v)) return clean(v);
  }
  return null;
}

/**
 * 実際のAmazon画面ではカードに<a>が無く、ASIN/subscriptionIdを示すリンクが存在しない。
 * 代わりに編集ボタンの data-edit-url 属性のクエリ文字列に入っているので、そこから拾う。
 */
async function readIdsFromEditUrl(cardLoc, editUrlId, baseUrl) {
  if (!editUrlId) return { subscriptionId: null, asin: null };

  // 実際のAmazonでは data-edit-url が「カード要素そのもの」に付いている。
  // locator()は子孫しか探さないため、まずカード自身の属性を見てから子孫を探す。
  let raw = await cardLoc.getAttribute(editUrlId.attr).catch(() => null);
  if (!raw) {
    const el = cardLoc.locator(editUrlId.selector).first();
    if ((await el.count().catch(() => 0)) === 0) return { subscriptionId: null, asin: null };
    raw = await el.getAttribute(editUrlId.attr).catch(() => null);
  }
  if (!raw) return { subscriptionId: null, asin: null };

  try {
    const u = new URL(raw, baseUrl);
    return {
      subscriptionId: u.searchParams.get(editUrlId.subscriptionIdParam) || null,
      asin: u.searchParams.get(editUrlId.asinParam) || null,
    };
  } catch {
    return { subscriptionId: null, asin: null };
  }
}

/**
 * 定期おトク便の一覧を取得する。
 * @returns {Promise<{items:Array, strategy:string, empty:boolean}>}
 */
export async function listSubscriptions(page, sel) {
  await scrollToBottom(page);
  await settle(page, 800);

  if (await anyPresent(page, sel.list.emptyMarkers, { timeout: 1000 })) {
    return { items: [], strategy: 'empty-marker', empty: true };
  }

  const { count, strategy } = await markCards(page, sel.list.card, sel.list.editTrigger);
  const items = [];

  for (let i = 0; i < count; i++) {
    const card = page.locator(`[data-teiki-card="${i}"]`);
    const f = sel.list.fields;

    const title =
      (await readValue(card, f.title)) ??
      clean((await card.innerText().catch(() => '')).split('\n')[0]);

    const idsFromUrl = await readIdsFromEditUrl(card, sel.list.editUrlId, sel.urls.base);

    const item = {
      index: i + 1,
      cardSelector: `[data-teiki-card="${i}"]`,
      subscriptionId: idsFromUrl.subscriptionId ?? (await readSubscriptionId(card, sel.list.idAttributes)),
      title: title ?? '(商品名を取得できませんでした)',
      url: absolutize(await readValue(card, f.url), sel.urls.base),
      image: await readValue(card, f.image),
      nextDelivery: stripLabel(await readValue(card, f.nextDelivery)),
      quantity: await readValue(card, f.quantity),
      frequency: await readValue(card, f.frequency),
      price: await readValue(card, f.price),
    };
    item.asin = idsFromUrl.asin ?? (item.url?.match(/\/(?:dp|product)\/([A-Z0-9]{10})/) || [])[1] ?? null;
    items.push(item);
  }

  return { items, strategy, empty: items.length === 0 };
}

/**
 * 「次回の配達日: 9月8日」のようにラベルごと拾ってしまった値から、ラベル部分を落とす。
 * 表示側でも「次回:」を付けるため、そのままだと "次回: 次回の配達日: 9月8日" になる。
 */
function stripLabel(value) {
  if (!value) return value;
  const stripped = value.replace(/^\s*(次回の配達日|次回のお届け予定日|次回のお届け|次回お届け|次回)\s*[:：]?\s*/, '');
  return clean(stripped) ?? value;
}

function absolutize(href, base) {
  if (!href) return null;
  if (/^https?:/.test(href)) return href;
  return base.replace(/\/$/, '') + (href.startsWith('/') ? href : `/${href}`);
}

/** アクション実行後に一覧を取り直す（DOMが作り替わるため index は毎回無効になる） */
export async function refresh(page, sel) {
  await page.goto(sel.urls.subscriptions, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return listSubscriptions(page, sel);
}
