// Network side of the crawler: HTTP fetches, robots.txt, and a family-safe DNS check
// so adult and malware domains from the seed list are skipped. Requests look like an
// ordinary browser's but the user agent always names the bot and links to the project.
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import robotsParser from "robots-parser";

// Some hosts take over a second to accept a connection; Node's default of 250 ms per
// address attempt gives up on them. Prefer IPv4 since many networks lack IPv6 routes.
setDefaultAutoSelectFamilyAttemptTimeout(3000);
setDefaultResultOrder("ipv4first");

export const USER_AGENT =
  "Mozilla/5.0 (compatible; WebSearchEngineBot/2.0; +https://github.com/tahamukhtar20/web-search-engine)";
const HEADERS = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "upgrade-insecure-requests": "1",
};
const MAX_BYTES = 2_000_000;

export type Page = { url: string; status: number; html: string };
/** The site asked us to stop (403/429/503) or served a bot challenge. */
export type Refusal = { refused: number };

/** Fetch an HTML page with a timeout and a size cap. Null for non-HTML or network errors. */
export async function fetchHtml(url: string, timeoutMs = 10_000): Promise<Page | Refusal | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      await res.body?.cancel();
      return { refused: res.status };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("html")) {
      await res.body?.cancel();
      return null;
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: res.url, status: res.status, html };
  } catch {
    return null;
  }
}

export type Robots = { allowed: (url: string) => boolean; delayMs: number | null; reachable: boolean };

/**
 * robots.txt for an origin (RFC 9309): 4xx means no restrictions; a 5xx or network
 * failure means "assume everything is disallowed" for this crawl.
 */
export async function fetchRobots(origin: string): Promise<Robots> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 400 && res.status < 500) return { allowed: () => true, delayMs: null, reachable: true };
    if (!res.ok) return { allowed: () => false, delayMs: null, reachable: false };
    const text = (await res.text()).slice(0, 500_000);
    const delay = robotsParser(res.url, text).getCrawlDelay(USER_AGENT);
    // Robots rules are per host; after a redirect (example.com -> www.example.com) check
    // URLs against the host the file actually came from.
    const base = new URL(res.url);
    const sameHost = (u: string) => {
      const x = new URL(u);
      x.protocol = base.protocol;
      x.host = base.host;
      return x.toString();
    };
    const parsed = robotsParser(res.url, text);
    return { allowed: (u) => parsed.isAllowed(sameHost(u), USER_AGENT) !== false, delayMs: delay ? delay * 1000 : null, reachable: true };
  } catch {
    return { allowed: () => false, delayMs: null, reachable: false };
  }
}

/**
 * Cloudflare's family resolver answers 0.0.0.0 for adult and malware domains.
 * Returns null when the check itself could not be done.
 */
export async function isFamilySafe(host: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://family.cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as { Answer?: { data: string }[] };
      return !(data.Answer ?? []).some((a) => a.data === "0.0.0.0");
    } catch {
      // Retry once, then report that we couldn't tell.
    }
  }
  return null;
}

// Interstitial titles are fixed phrases; a real page may still mention "captcha".
const CHALLENGE_TITLE = /^\s*(just a moment|attention required|access denied|are you a robot|verify you are human|checking your browser|security check|one more step)/i;
const CHALLENGE_BODY = /just a moment|attention required|access denied|are you a robot|verify you are human|checking your browser|enable javascript and cookies|captcha/i;

/** True for bot-check interstitials (Cloudflare, Akamai, captchas) rather than real pages. */
export const isChallenge = (title: string, body: string) =>
  CHALLENGE_TITLE.test(title) || (body.length < 600 && CHALLENGE_BODY.test(body));
