import { resolveFirst, readValue, clean } from './locator.js';
import { scrollToBottom, settle, anyPresent } from './browser.js';

/**
 * ページ内で定期おトク便のカードを特定し、data-teiki-card="N" を打つ。
 * 設定セレクタで見つからない場合は、商品リンクから祖先をたどるヒューリスティックに落ちる。
 * @returns {Promise<{count:number, strategy:string}>}
 */
async function markCards(page, cardSpecs) {
  const cssCandidates = cardSpecs.filter((s) => s.css).map((s) => s.css);

  return await page.evaluate((cssList) => {
    document.querySelectorAll('[data-teiki-card]').forEach((el) => el.removeAttribute('data-teiki-card'));

    const looksLikeCard = (el) => {
      if (!el || !el.querySelector) return false;
      const t = el.innerText || '';
      const hasProduct = !!el.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], img');
      const hasSubWords = /定期|お届け|スキップ|キャンセル|配送/.test(t);
      return hasProduct && hasSubWords && t.length > 15 && t.length < 4000;
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

    // --- 戦略2: 商品リンクの祖先をたどる ---
    const anchors = Array.from(document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]'));
    const asinOf = (href) => (href.match(/\/(?:dp|product)\/([A-Z0-9]{10})/) || [])[1] || null;

    const byAsin = new Map();
    for (const a of anchors) {
      const asin = asinOf(a.getAttribute('href') || '');
      if (!asin || byAsin.has(asin)) continue;
      byAsin.set(asin, a);
    }

    const cards = [];
    for (const [asin, anchor] of byAsin) {
      let node = anchor;
      let best = null;
      for (let depth = 0; depth < 12 && node.parentElement; depth++) {
        node = node.parentElement;
        if (node === document.body) break;
        // 別商品まで巻き込んだら、その手前で止める
        const asins = new Set(
          Array.from(node.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]'))
            .map((x) => asinOf(x.getAttribute('href') || ''))
            .filter(Boolean)
        );
        if (asins.size > 1) break;
        if (looksLikeCard(node)) best = node;
      }
      if (best && !cards.some((c) => c.contains(best) || best.contains(c))) cards.push(best);
    }

    cards.forEach((el, i) => el.setAttribute('data-teiki-card', String(i)));
    return { count: cards.length, strategy: 'heuristic:anchor-ancestor' };
  }, cssCandidates);
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
 * 定期おトク便の一覧を取得する。
 * @returns {Promise<{items:Array, strategy:string, empty:boolean}>}
 */
export async function listSubscriptions(page, sel) {
  await scrollToBottom(page);
  await settle(page, 800);

  if (await anyPresent(page, sel.list.emptyMarkers, { timeout: 1000 })) {
    return { items: [], strategy: 'empty-marker', empty: true };
  }

  const { count, strategy } = await markCards(page, sel.list.card);
  const items = [];

  for (let i = 0; i < count; i++) {
    const card = page.locator(`[data-teiki-card="${i}"]`);
    const f = sel.list.fields;

    const title =
      (await readValue(card, f.title)) ??
      clean((await card.innerText().catch(() => '')).split('\n')[0]);

    const item = {
      index: i + 1,
      cardSelector: `[data-teiki-card="${i}"]`,
      subscriptionId: await readSubscriptionId(card, sel.list.idAttributes),
      title: title ?? '(商品名を取得できませんでした)',
      url: absolutize(await readValue(card, f.url), sel.urls.base),
      image: await readValue(card, f.image),
      nextDelivery: await readValue(card, f.nextDelivery),
      quantity: await readValue(card, f.quantity),
      frequency: await readValue(card, f.frequency),
      price: await readValue(card, f.price),
    };
    item.asin = (item.url?.match(/\/(?:dp|product)\/([A-Z0-9]{10})/) || [])[1] ?? null;
    items.push(item);
  }

  return { items, strategy, empty: items.length === 0 };
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
