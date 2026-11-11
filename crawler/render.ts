// Headless Chrome for pages whose content is built by JavaScript. Used only when the
// plain HTML has too little text. Images, media, fonts and stylesheets are not loaded.
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { USER_AGENT } from "./fetch.ts";

const MAX_RENDERS = 6;
let browser: Promise<Browser> | null = null;
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_RENDERS) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Render a page and return its final URL and HTML, or null on failure. */
export function render(url: string, timeoutMs = 15_000): Promise<{ url: string; status: number; html: string } | null> {
  browser ??= chromium.launch({ channel: "chrome", headless: true });
  return slot(async () => {
    const b = await browser!;
    const context = await b.newContext({ userAgent: USER_AGENT, locale: "en-US", javaScriptEnabled: true });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        ["image", "media", "font", "stylesheet"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      // Give client-side rendering a moment, but don't wait for every tracker to settle.
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      return { url: page.url(), status: res?.status() ?? 0, html: await page.content() };
    } catch {
      return null;
    } finally {
      await context.close();
    }
  });
}

export async function closeBrowser() {
  if (browser) await (await browser).close();
}
