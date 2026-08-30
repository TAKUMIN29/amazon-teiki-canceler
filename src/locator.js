/**
 * セレクタ仕様(JSON) → Playwright Locator への変換。
 * 候補配列を上から試し、最初に「実際に存在するもの」を返す。
 */

/** 単一の仕様を Locator に変換する（存在確認はしない） */
export function toLocator(root, spec) {
  const nth = typeof spec.nth === 'number' ? spec.nth : null;
  let loc;

  if (spec.css) {
    loc = root.locator(spec.css);
  } else if (spec.xpath) {
    loc = root.locator(`xpath=${spec.xpath}`);
  } else if (spec.role) {
    const name = spec.regex ? new RegExp(escapeRe(spec.name)) : spec.name;
    loc = root.getByRole(spec.role, name ? { name, exact: !!spec.exact } : undefined);
  } else if (spec.text) {
    const text = spec.regex ? new RegExp(escapeRe(spec.text)) : spec.text;
    const base = root.getByText(text, { exact: !!spec.exact });
    // テキストノードを含む最小要素だと click できないことがあるので、
    // クリック可能な祖先(button/a)へ寄せた候補も併せて持つ
    loc = spec.tag ? root.locator(spec.tag, { hasText: text }) : base;
  } else {
    throw new Error(`不正なセレクタ仕様: ${JSON.stringify(spec)}`);
  }

  return nth === null ? loc : loc.nth(nth);
}

/**
 * 候補配列から、実際にDOM上に存在する最初の Locator を返す。
 * @returns {Promise<{locator, spec, index}|null>}
 */
export async function resolveFirst(root, specs, { timeout = 4000, visible = true } = {}) {
  const list = Array.isArray(specs) ? specs : [specs];
  const deadline = Date.now() + timeout;

  // 1周目は即時判定、見つからなければ deadline まで軽くリトライ
  for (let pass = 0; ; pass++) {
    for (let i = 0; i < list.length; i++) {
      const spec = list[i];
      let loc;
      try {
        loc = toLocator(root, spec);
      } catch {
        continue;
      }
      try {
        const count = await loc.count();
        if (count === 0) continue;
        const first = spec.nth === undefined ? loc.first() : loc;
        if (visible) {
          if (!(await first.isVisible().catch(() => false))) continue;
        }
        return { locator: first, spec, index: i };
      } catch {
        /* stale element 等は次の候補へ */
      }
    }
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

/** 候補のいずれかが存在するか（マーカー判定用） */
export async function anyPresent(root, specs, { timeout = 1500 } = {}) {
  const hit = await resolveFirst(root, specs, { timeout, visible: true });
  return !!hit;
}

/** 仕様に attr が指定されていれば属性値、なければテキストを取り出す */
export async function readValue(root, specs) {
  const hit = await resolveFirst(root, specs, { timeout: 800, visible: false });
  if (!hit) return null;
  try {
    if (hit.spec.attr) {
      const v = await hit.locator.getAttribute(hit.spec.attr);
      return clean(v);
    }
    const t = await hit.locator.innerText();
    return clean(t);
  } catch {
    return null;
  }
}

export function clean(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
}

const RE_SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/** getByText/getByRole に正規表現を渡す前に、メタ文字を無害化する */
function escapeRe(s) {
  const bs = String.fromCharCode(92);
  return Array.from(String(s == null ? "" : s))
    .map((c) => (RE_SPECIAL.has(c) ? bs + c : c))
    .join("");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
