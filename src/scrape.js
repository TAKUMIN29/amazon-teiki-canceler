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

/**
 * マーク済みの全カードから、全フィールドを「ブラウザ側で1回だけ」まとめて取り出す。
 *
 * 以前は1フィールドにつき候補ごとにPlaywrightのLocatorで往復していたため、
 * 1商品あたり25回以上・商品10件で250回以上の往復が直列に発生し、一覧取得に
 * 10秒近くかかっていた。ここで page.evaluate 1回に畳み込むことで往復は1回になる。
 *
 * 対応する候補仕様は css / xpath（+ attr, nth）のみ。text / role 指定は
 * ブラウザ側で再現しないので unsupported として返し、Node側で従来の
 * readValue にフォールバックする（config/selectors.json の list.fields は
 * 現状すべて css/xpath なので、通常はフォールバックは発生しない）。
 */
async function extractCards(page, sel) {
  const fieldNames = ['title', 'url', 'image', 'nextDelivery', 'quantity', 'frequency', 'price'];
  const fieldSpecs = {};
  for (const name of fieldNames) fieldSpecs[name] = sel.list.fields[name] ?? [];

  return await page.evaluate(
    ({ fieldSpecs, fieldNames, idAttributes, editUrlId }) => {
      const clean = (s) => {
        if (s == null) return null;
        const t = String(s).replace(/\s+/g, ' ').trim();
        return t.length ? t : null;
      };

      /** 1つの候補仕様を、カード配下で解決して値を返す。解決できなければ undefined。 */
      function readSpec(card, spec) {
        let el = null;
        if (spec.css) {
          let nodes;
          try {
            nodes = card.querySelectorAll(spec.css);
          } catch {
            return undefined;
          }
          el = nodes[typeof spec.nth === 'number' ? spec.nth : 0] ?? null;
        } else if (spec.xpath) {
          try {
            const r = document.evaluate(spec.xpath, card, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            el = r.snapshotItem(typeof spec.nth === 'number' ? spec.nth : 0);
          } catch {
            return undefined;
          }
        } else {
          return undefined; // text/role はブラウザ側では扱わない
        }
        if (!el) return undefined;
        return clean(spec.attr ? el.getAttribute(spec.attr) : el.innerText);
      }

      /** 候補配列を上から順に試し、最初に値が取れたものを返す */
      function readField(card, specs) {
        let sawUnsupported = false;
        for (const spec of specs) {
          if (!spec.css && !spec.xpath) {
            sawUnsupported = true;
            continue;
          }
          const v = readSpec(card, spec);
          if (v != null) return { value: v };
        }
        return { value: null, unsupported: sawUnsupported };
      }

      const out = [];
      const cards = document.querySelectorAll('[data-teiki-card]');
      for (const card of cards) {
        const index = Number(card.getAttribute('data-teiki-card'));

        const fields = {};
        const needsFallback = [];
        for (const name of fieldNames) {
          const r = readField(card, fieldSpecs[name]);
          fields[name] = r.value;
          // 候補が全滅し、かつ扱えない指定(text/role)が混ざっていた場合だけ
          // Node側の従来経路で取り直してもらう
          if (r.value == null && r.unsupported) needsFallback.push(name);
        }

        // カード自身の属性から購読IDらしきものを拾う
        let subscriptionId = null;
        for (const attr of idAttributes) {
          const v = clean(card.getAttribute(attr));
          if (v && /[A-Za-z0-9]/.test(v)) {
            subscriptionId = v;
            break;
          }
        }

        // 実際のAmazonでは data-edit-url が「カード要素そのもの」に付いている。
        // querySelectorは子孫しか見ないため、まずカード自身の属性を確認する。
        let editUrl = null;
        if (editUrlId) {
          editUrl = card.getAttribute(editUrlId.attr);
          if (!editUrl) {
            let el = null;
            try {
              el = card.querySelector(editUrlId.selector);
            } catch {
              el = null;
            }
            if (el) editUrl = el.getAttribute(editUrlId.attr);
          }
        }

        // 候補が全滅したときの保険として、カード先頭行のテキストも渡しておく
        const firstLine = clean((card.innerText || '').split('\n')[0]);

        out.push({ index, fields, needsFallback, subscriptionId, editUrl, firstLine });
      }
      return out;
    },
    {
      fieldSpecs,
      fieldNames,
      idAttributes: sel.list.idAttributes ?? [],
      editUrlId: sel.list.editUrlId ?? null,
    }
  );
}

/** editUrl のクエリ文字列から subscriptionId / ASIN を取り出す */
function parseEditUrl(rawUrl, editUrlId, baseUrl) {
  if (!rawUrl || !editUrlId) return { subscriptionId: null, asin: null };
  try {
    const u = new URL(rawUrl, baseUrl);
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
  await settle(page, 300);

  // カード検出を先に行う。「登録が無い」ことの確認(emptyMarkers)は候補が
  // 見つからずタイムアウトまで待つ処理なので、商品がある通常時に毎回1秒
  // 待たされていた。カードが1件も取れなかったときだけ確認すれば足りる。
  const { count, strategy } = await markCards(page, sel.list.card, sel.list.editTrigger);
  if (count === 0) {
    if (await anyPresent(page, sel.list.emptyMarkers, { timeout: 1000 })) {
      return { items: [], strategy: 'empty-marker', empty: true };
    }
    return { items: [], strategy, empty: true };
  }

  // 全カード・全フィールドをブラウザ側で1回にまとめて取得する（往復1回）
  const raws = await extractCards(page, sel);
  const items = [];

  for (const raw of raws) {
    const cardSelector = `[data-teiki-card="${raw.index}"]`;
    const fields = { ...raw.fields };

    // text/role 指定しか候補が無く、ブラウザ側で取れなかったフィールドだけ
    // 従来のLocator経路で取り直す（通常は発生しない）
    if (raw.needsFallback.length > 0) {
      const card = page.locator(cardSelector);
      for (const name of raw.needsFallback) {
        fields[name] = await readValue(card, sel.list.fields[name] ?? []);
      }
    }

    const ids = parseEditUrl(raw.editUrl, sel.list.editUrlId, sel.urls.base);

    const item = {
      index: raw.index + 1,
      cardSelector,
      subscriptionId: ids.subscriptionId ?? raw.subscriptionId,
      title: fields.title ?? raw.firstLine ?? '(商品名を取得できませんでした)',
      url: absolutize(fields.url, sel.urls.base),
      image: fields.image,
      nextDelivery: stripLabel(fields.nextDelivery),
      quantity: fields.quantity,
      frequency: fields.frequency,
      price: fields.price,
    };
    item.asin = ids.asin ?? (item.url?.match(/\/(?:dp|product)\/([A-Z0-9]{10})/) || [])[1] ?? null;
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
