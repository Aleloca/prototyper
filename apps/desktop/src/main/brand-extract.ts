/**
 * Raw design data read from a live website. Produced by `pageExtractor`, which runs inside the page.
 */
export interface BrandRaw {
  url: string;
  title: string;
  description: string;
  lang: string;
  /** Colors with how much they are used, by role. Weights are relative (area in px² or characters). */
  colors: { hex: string; weight: number; roles: Record<string, number> }[];
  fonts: { role: "heading" | "body" | "button" | "nav"; family: string; weight: string; size: string; lineHeight: string; letterSpacing: string; transform: string }[];
  fontFaces: string[];
  googleFonts: string[];
  buttons: { text: string; background: string; color: string; radius: string; padding: string; border: string; weight: string; transform: string; shadow: string }[];
  radii: { value: string; count: number }[];
  shadows: { value: string; count: number }[];
  logo: { src?: string; svg?: string; alt?: string; width: number; height: number } | null;
  favicon: string | null;
  ogImage: string | null;
  copy: { h1: string[]; h2: string[]; paragraphs: string[]; ctas: string[] };
  navLinks: { text: string; href: string }[];
  pageHeight: number;
}

/**
 * Runs in the website's page (injected as source text), so it must be fully self-contained:
 * no imports, no references to anything outside this function.
 */
export function pageExtractor(): BrandRaw {
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const toHex = (c: string): string | null => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) < 0.5) return null;
    return "#" + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
  };

  const colors = new Map<string, { weight: number; roles: Record<string, number> }>();
  const addColor = (c: string, weight: number, role: string) => {
    const hex = toHex(c);
    if (!hex || weight <= 0) return;
    const entry = colors.get(hex) ?? { weight: 0, roles: {} };
    entry.weight += weight;
    entry.roles[role] = (entry.roles[role] ?? 0) + weight;
    colors.set(hex, entry);
  };

  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const all = Array.from(document.body.querySelectorAll("*")).slice(0, 6000);
  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width * r.height, 1440 * 900);
    addColor(s.backgroundColor, area, "background");
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (ownText) addColor(s.color, ownText.length * 40, el.closest("a") ? "link" : /^H[1-6]$/.test(el.tagName) ? "heading" : "text");
    if (s.borderTopWidth !== "0px" && s.borderTopStyle !== "none") addColor(s.borderTopColor, r.width * 2, "border");
    if (s.borderRadius && s.borderRadius !== "0px") radii.set(s.borderRadius, (radii.get(s.borderRadius) ?? 0) + 1);
    if (s.boxShadow && s.boxShadow !== "none") shadows.set(s.boxShadow, (shadows.get(s.boxShadow) ?? 0) + 1);
  }
  addColor(getComputedStyle(document.body).backgroundColor, 1440 * 900, "background");

  const buttonEls = Array.from(
    document.querySelectorAll('button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"], a[class*="cta"], .wp-block-button__link'),
  ).filter(visible);
  const buttons = buttonEls.slice(0, 12).map((el) => {
    const s = getComputedStyle(el);
    addColor(s.backgroundColor, 20000, "button");
    return {
      text: (el.textContent ?? (el as HTMLInputElement).value ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      background: s.backgroundColor,
      color: s.color,
      radius: s.borderRadius,
      padding: s.padding,
      border: s.border,
      weight: s.fontWeight,
      transform: s.textTransform,
      shadow: s.boxShadow,
    };
  });

  const fontOf = (role: "heading" | "body" | "button" | "nav", el: Element | null) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return { role, family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, transform: s.textTransform };
  };
  const firstVisible = (sel: string) => Array.from(document.querySelectorAll(sel)).find(visible) ?? null;
  const fonts = [
    fontOf("heading", firstVisible("h1")),
    fontOf("heading", firstVisible("h2")),
    fontOf("heading", firstVisible("h3")),
    fontOf("body", firstVisible("main p, article p, p")),
    fontOf("button", buttonEls[0] ?? null),
    fontOf("nav", firstVisible("nav a, header a")),
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  const fontFaces = Array.from(document.fonts ?? [])
    .filter((f) => f.status === "loaded")
    .map((f) => `${f.family.replace(/["']/g, "")} ${f.weight} ${f.style}`);
  const googleFonts = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"]')).map((l) => l.href);

  const abs = (u: string | null | undefined) => {
    if (!u) return null;
    try {
      return new URL(u, location.href).href;
    } catch {
      return null;
    }
  };

  const header = document.querySelector("header, [role=banner], .header, #header, nav") ?? document.body;
  const logoCandidates = Array.from(header.querySelectorAll("img, svg")).filter(visible);
  const isLogo = (el: Element) => /logo|brand/i.test(`${el.getAttribute("class") ?? ""} ${el.id} ${el.getAttribute("alt") ?? ""} ${el.getAttribute("src") ?? ""} ${el.parentElement?.getAttribute("class") ?? ""}`);
  const logoEl = logoCandidates.find(isLogo) ?? logoCandidates.find((el) => el.closest("a[href='/'], a[href='./'], a[href$='/']")) ?? logoCandidates[0] ?? null;
  let logo: BrandRaw["logo"] = null;
  if (logoEl) {
    const r = logoEl.getBoundingClientRect();
    logo =
      logoEl.tagName.toLowerCase() === "svg"
        ? { svg: logoEl.outerHTML.slice(0, 200_000), width: r.width, height: r.height }
        : { src: abs((logoEl as HTMLImageElement).currentSrc || logoEl.getAttribute("src")) ?? undefined, alt: logoEl.getAttribute("alt") ?? undefined, width: r.width, height: r.height };
  }

  const texts = (sel: string, max: number, len: number) =>
    Array.from(document.querySelectorAll(sel))
      .filter(visible)
      .map((e) => (e.textContent ?? "").trim().replace(/\s+/g, " "))
      .filter((t) => t.length > 2)
      .slice(0, max)
      .map((t) => t.slice(0, len));

  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("header a[href], nav a[href]"))
    .filter(visible)
    .map((a) => ({ text: (a.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60), href: a.href }))
    .filter((l) => l.text && l.href.startsWith(location.origin) && !l.href.includes("#"));

  return {
    url: location.href,
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "",
    lang: document.documentElement.lang,
    colors: Array.from(colors, ([hex, v]) => ({ hex, ...v }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 40),
    fonts,
    fontFaces: Array.from(new Set(fontFaces)).slice(0, 30),
    googleFonts,
    buttons,
    radii: Array.from(radii, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    shadows: Array.from(shadows, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    logo,
    favicon: abs(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href")),
    ogImage: abs(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content),
    copy: {
      h1: texts("h1", 3, 200),
      h2: texts("h2", 12, 160),
      paragraphs: texts("main p, article p, section p", 12, 400),
      ctas: buttons.map((b) => b.text).filter(Boolean),
    },
    navLinks: Array.from(new Map(navLinks.map((l) => [l.href, l])).values()).slice(0, 20),
    pageHeight: document.documentElement.scrollHeight,
  };
}

/**
 * Script run before screenshots: hide cookie banners and chat widgets. Only fixed/sticky overlays
 * and dialogs are hidden — consent tools often put classes like "show--consent" on <body>, so a
 * plain CSS selector would hide the whole page.
 */
export const HIDE_OVERLAYS_JS = `(() => {
  const re = /cookie|consent|gdpr|iubenda|cookiebot|onetrust|cky-|cmp-|hubspot-messages|intercom|crisp|tawk|zendesk|chat-widget/i;
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    const overlay = s.position === "fixed" || s.position === "sticky" || el.tagName === "DIALOG";
    if (!overlay) continue;
    const named = re.test(String(el.id) + " " + String(el.className) + " " + (el.getAttribute("aria-label") || ""));
    // Banners with neutral class names: a fixed box talking about cookies and offering buttons.
    const banner = /cookie|consenso|consent/i.test(el.textContent || "") && el.querySelector("button, a[role=button]") && el.getBoundingClientRect().height < innerHeight * 0.9;
    if (named || banner) el.style.setProperty("display", "none", "important");
  }
  for (const el of [document.documentElement, document.body]) el.style.setProperty("overflow", "visible", "important");
})()`;

/** Group near-identical colors (e.g. #1f4fd6 and #1e4fd5) so the palette is not cluttered. */
export function clusterColors(colors: BrandRaw["colors"], threshold = 18): BrandRaw["colors"] {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const out: BrandRaw["colors"] = [];
  for (const c of colors) {
    const [r, g, b] = rgb(c.hex);
    const near = out.find((o) => {
      const [r2, g2, b2] = rgb(o.hex);
      return Math.hypot(r - r2, g - g2, b - b2) < threshold;
    });
    if (near) {
      near.weight += c.weight;
      for (const [role, w] of Object.entries(c.roles)) near.roles[role] = (near.roles[role] ?? 0) + w;
    } else out.push({ hex: c.hex, weight: c.weight, roles: { ...c.roles } });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
