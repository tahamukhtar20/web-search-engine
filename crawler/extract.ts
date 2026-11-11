// Pull the parts of an HTML page the index needs: title, description, headings,
// readable body text and outgoing links. Boilerplate (scripts, nav, footers, forms)
// is dropped first.
import { load } from "cheerio";

export type Extracted = {
  title: string;
  description: string;
  headings: string;
  body: string;
  lang: string;
  links: string[];
};

const DROP = "script, style, noscript, template, svg, canvas, iframe, form, button, select, textarea, nav, footer, aside, [aria-hidden=true], [hidden]";
const BODY = "p, li, td, th, dd, dt, blockquote, h3, h4, h5, h6, figcaption, article, main";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function extract(html: string, baseUrl: string): Extracted {
  const $ = load(html);
  const lang = ($("html").attr("lang") ?? "").toLowerCase();
  const title = clean($("title").first().text()).slice(0, 300);
  const description = clean(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
  ).slice(0, 500);

  // Links before boilerplate removal: navigation still says what a site links to.
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(href)) return;
    try {
      const u = new URL(href, baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      u.hash = "";
      links.add(u.toString());
    } catch {
      // Malformed href; skip it.
    }
  });

  $(DROP).remove();
  const headings = clean($("h1, h2").map((_, el) => $(el).text()).get().join(" . ")).slice(0, 2000);
  // Leaf-ish blocks only, so nested containers don't repeat their children's text.
  const parts: string[] = [];
  $(BODY).each((_, el) => {
    if ($(el).find(BODY).length) return;
    const t = clean($(el).text());
    if (t.length > 1) parts.push(t);
  });
  let body = parts.join(" ");
  if (body.length < 200) body = clean($("body").text());
  return { title, description, headings, body: body.slice(0, 20000), lang, links: [...links] };
}

/** True when the page is probably English: a declared en* lang, or mostly ASCII letters. */
export function looksEnglish(e: Extracted): boolean {
  if (e.lang) return e.lang.startsWith("en");
  const sample = (e.title + " " + e.body).slice(0, 3000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  const ascii = sample.match(/[a-z]/gi)?.length ?? 0;
  return letters > 0 && ascii / letters > 0.9;
}
