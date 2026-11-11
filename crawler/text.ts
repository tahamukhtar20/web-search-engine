// Text normalisation shared by the index builder and the browser search: lowercase,
// split on non-letters/digits, drop stop words and odd lengths, Porter-stem.
import { stemmer } from "stemmer";

// A standard English stop-word list (close to NLTK's).
const STOP = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other
  our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when where which while who whom why will
  with would you your yours yourself yourselves also may might must shall us via etc`
    .split(/\s+/)
    .filter(Boolean),
);

export const isStopWord = (w: string) => STOP.has(w);

/** Words as they appear (lowercased), before stop-word removal and stemming. */
export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];
}

/** Index terms: stop words and very short/long tokens removed, then stemmed. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (w.length < 2 || w.length > 32 || STOP.has(w)) continue;
    // Long digit runs (phone numbers, ids) are noise for search.
    if (/^\d{5,}$/.test(w)) continue;
    out.push(stemmer(w));
  }
  return out;
}

/** Each query word with the term it becomes, for showing how a query was read. */
export function explainQuery(text: string): { word: string; term: string | null }[] {
  return words(text).map((w) => ({
    word: w,
    term: w.length < 2 || w.length > 32 || STOP.has(w) ? null : stemmer(w),
  }));
}
