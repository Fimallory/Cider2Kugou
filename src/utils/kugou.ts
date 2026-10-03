/**
 * KuGou search + launch-link layer.
 *
 * Search sources (in priority order, first success wins):
 *  1. `songsearch.kugou.com/song_search_v2` — HTTPS works, no CORS ACAO header
 *     (browser fetch will be blocked; use inside try, fall through on failure).
 *  2. `msearchcdn.kugou.com/api/v3/search/song` / `mobilecdn...` — HTTP-only,
 *     cert mismatch over HTTPS; reachable via plain HTTP from browser context.
 *
 * Launch links (priority: android -> pc -> web, per user choice):
 *  - android: `intent://www.kugou.com/song/#hash=..&album_id=..`
 *    `#Intent;package=com.kugou.android;scheme=https;end` — Chrome on Android
 *    routes it to the installed KuGou app when present.
 *  - pc: `https://www.kugou.com/song/#hash=..&album_id=..` opened via
 *    `window.open` (Cider is an Electron shell; no `kugou://` protocol is
 *    registered on stock Windows installs — verified via HKCR scan).
 *  - web fallback: keyword search page
 *    `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=..`
 */

export interface KugouCandidate {
  hash: string;
  albumId: string;
  songName: string;
  singerName: string;
  albumName: string;
  duration: number;
  /** 0..1 fuzzy score against the Apple Music query (filled by rankKugou). */
  score: number;
  /** Which search source produced this candidate. */
  source: string;
  /** Direct PC/web play page for this exact track. */
  playUrl: string;
}

export interface KugouLaunchLinks {
  /** Exact-track page (PC client takeover when installed, else web play). */
  playUrl: string;
  /** Android Chrome intent link (app when installed, else browser fallback). */
  androidIntent: string;
  /** Keyword search page fallback (no hash needed). */
  searchUrl: string;
}

const SEARCH_TIMEOUT_MS = 12_000;
const PAGESIZE = 8;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await withTimeout(
    fetch(url, { mode: "cors", credentials: "omit" }),
    SEARCH_TIMEOUT_MS,
    `kugou ${url}`
  );
  if (!res.ok) throw new Error(`kugou search: ${res.status}`);
  const text = await res.text();
  // song_search_v2 may wrap in JSONP when callback param is echoed; strip it.
  const trimmed = text.trim();
  if (/^[A-Za-z0-9_.]+\(/.test(trimmed)) {
    const start = trimmed.indexOf("(");
    const end = trimmed.lastIndexOf(")");
    return JSON.parse(trimmed.slice(start + 1, end));
  }
  return JSON.parse(trimmed);
}

interface V2Item {
  FileHash?: string;
  AlbumID?: string;
  SongName?: string;
  SingerName?: string;
  AlbumName?: string;
  Duration?: number;
}

interface V3Item {
  hash?: string;
  album_id?: string;
  songname?: string;
  singername?: string;
  album_name?: string;
  duration?: number;
}

function fromV2(lists: V2Item[], source: string): KugouCandidate[] {
  const out: KugouCandidate[] = [];
  for (const it of lists ?? []) {
    const hash = String(it.FileHash ?? "").trim();
    const albumId = String(it.AlbumID ?? "").trim();
    if (!hash || !albumId || albumId === "0") continue;
    out.push({
      hash,
      albumId,
      songName: String(it.SongName ?? ""),
      singerName: String(it.SingerName ?? ""),
      albumName: String(it.AlbumName ?? ""),
      duration: Number(it.Duration ?? 0) || 0,
      score: 0,
      source,
      playUrl: playUrl(hash, albumId),
    });
  }
  return out;
}

function fromV3(info: V3Item[], source: string): KugouCandidate[] {
  const out: KugouCandidate[] = [];
  for (const it of info ?? []) {
    const hash = String(it.hash ?? "").trim();
    const albumId = String(it.album_id ?? "").trim();
    if (!hash || !albumId || albumId === "0") continue;
    out.push({
      hash,
      albumId,
      songName: String(it.songname ?? ""),
      singerName: String(it.singername ?? ""),
      albumName: String(it.album_name ?? ""),
      duration: Number(it.duration ?? 0) || 0,
      score: 0,
      source,
      playUrl: playUrl(hash, albumId),
    });
  }
  return out;
}

async function searchV2(keyword: string): Promise<KugouCandidate[]> {
  const url =
    `https://songsearch.kugou.com/song_search_v2` +
    `?keyword=${encodeURIComponent(keyword)}` +
    `&page=1&pagesize=${PAGESIZE}&platform=WebFilter&format=json`;
  const json = (await fetchJson(url)) as {
    data?: { lists?: V2Item[] };
  };
  return fromV2(json?.data?.lists ?? [], "song_search_v2");
}

async function searchCdnV3(keyword: string): Promise<KugouCandidate[]> {
  // HTTPS cert is mismatched for *.kugou.com CDN hosts (verified 2026-10-03),
  // so plain HTTP is used here (same as official web widgets do).
  const hosts = ["msearchcdn.kugou.com", "mobilecdn.kugou.com"];
  let lastErr: unknown = null;
  for (const host of hosts) {
    const url =
      `http://${host}/api/v3/search/song` +
      `?format=json&keyword=${encodeURIComponent(keyword)}` +
      `&page=1&pagesize=${PAGESIZE}&plat=0&version=9108`;
    try {
      const json = (await fetchJson(url)) as {
        data?: { info?: V3Item[] };
      };
      const cands = fromV3(json?.data?.info ?? [], `cdn-v3:${host}`);
      if (cands.length) return cands;
      // Empty but valid response: still a success, stop rotating hosts.
      return cands;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("cdn v3 failed");
}

/**
 * Search KuGou with automatic source fallback.
 * Returns candidates in source order (scoring applied separately by rankKugou),
 * or throws when every source fails.
 */
export async function searchKugou(
  title: string,
  artist: string
): Promise<KugouCandidate[]> {
  const keyword = [title, artist].filter(Boolean).join(" ").trim() || title;
  const errors: string[] = [];
  // Primary: v2 (HTTPS). CORS may block it in-browser — fall through then.
  try {
    const c = await searchV2(keyword);
    if (c.length) return c;
  } catch (e) {
    errors.push(`v2: ${e instanceof Error ? e.message : e}`);
  }
  // Fallback: CDN v3 over HTTP.
  try {
    const c = await searchCdnV3(keyword);
    if (c.length) return c;
  } catch (e) {
    errors.push(`v3: ${e instanceof Error ? e.message : e}`);
  }
  // Last resort: title-only query (artist names often mismatch across regions).
  if (artist) {
    try {
      const c = await searchV2(title);
      if (c.length) return c;
    } catch (e) {
      errors.push(`v2-title: ${e instanceof Error ? e.message : e}`);
    }
    try {
      const c = await searchCdnV3(title);
      if (c.length) return c;
    } catch (e) {
      errors.push(`v3-title: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "酷狗搜不到这首歌");
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/** Normalize for comparison: lowercase, strip brackets content, punctuation, spaces. */
export function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** Jaccard-ish char bigram similarity 0..1. */
function bigramSim(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    const t = ` ${s} `;
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = grams(a);
  const mb = grams(b);
  // Dice coefficient over bigram multisets.
  let sizeA = 0;
  let sizeB = 0;
  for (const v of ma.values()) sizeA += v;
  for (const v of mb.values()) sizeB += v;
  let hit = 0;
  for (const [g, ca] of ma) hit += Math.min(ca, mb.get(g) ?? 0);
  return sizeA + sizeB === 0 ? 0 : (2 * hit) / (sizeA + sizeB);
}

/**
 * Score a candidate 0..1. Title weighs 0.7, artist 0.3.
 * Exact normalized match short-circuits to ~1.
 */
export function scoreCandidate(
  c: KugouCandidate,
  title: string,
  artist: string
): number {
  const nt = norm(title);
  const na = norm(artist);
  const ct = norm(c.songName);
  const ca = norm(c.singerName);
  let ts: number;
  if (ct && nt && (ct === nt || ct.includes(nt) || nt.includes(ct))) {
    ts = ct === nt ? 1 : 0.9;
  } else {
    ts = bigramSim(ct, nt);
  }
  let as: number;
  if (!na) {
    as = 0.5;
  } else if (ca && (ca === na || ca.includes(na) || na.includes(ca))) {
    as = ca === na ? 1 : 0.9;
  } else {
    as = bigramSim(ca, na);
  }
  return ts * 0.7 + as * 0.3;
}

/** Attach scores and sort best-first (stable). */
export function rankKugou(
  cands: KugouCandidate[],
  title: string,
  artist: string
): KugouCandidate[] {
  return cands
    .map((c) => ({ ...c, score: scoreCandidate(c, title, artist) }))
    .sort((a, b) => b.score - a.score);
}

/** Above this score the best hit auto-launches without asking. */
export const AUTO_MATCH_THRESHOLD = 0.82;

// ---------------------------------------------------------------------------
// Launch links: android -> pc -> web
// ---------------------------------------------------------------------------

export function playUrl(hash: string, albumId: string): string {
  return `https://www.kugou.com/song/#hash=${hash}&album_id=${albumId}`;
}

export function androidIntentUrl(hash: string, albumId: string): string {
  return (
    `intent://www.kugou.com/song/#hash=${hash}&album_id=${albumId}` +
    `#Intent;package=com.kugou.android;scheme=https;end`
  );
}

export function webSearchUrl(title: string, artist: string): string {
  const kw = [title, artist].filter(Boolean).join(" ").trim();
  return (
    `https://www.kugou.com/yy/html/search.html` +
    `#searchType=song&searchKeyWord=${encodeURIComponent(kw)}`
  );
}

export function buildLaunchLinks(
  c: Pick<KugouCandidate, "hash" | "albumId">,
  title: string,
  artist: string
): KugouLaunchLinks {
  return {
    playUrl: playUrl(c.hash, c.albumId),
    androidIntent: androidIntentUrl(c.hash, c.albumId),
    searchUrl: webSearchUrl(title, artist),
  };
}

/**
 * Open a link from inside the Cider/Electron shell.
 * `window.open(url, "_blank")` lets the host shell route https to the OS
 * default browser (which then takes over to the KuGou PC client when the
 * web page triggers it, or just plays on web).
 */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise<void>((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) resolve();
      else reject(new Error("copy failed"));
    } catch (e) {
      reject(e instanceof Error ? e : new Error("copy failed"));
    }
  });
}
