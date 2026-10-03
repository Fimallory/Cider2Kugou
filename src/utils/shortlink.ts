import { md5Hex } from "./md5";
import { useConfig } from "../main";

/**
 * Exchange `encode_album_audio_id` (mixsong short code) via the login-state
 * songinfo API (Meting `kugou_url_new` flow).
 *
 * No `Cookie` request header is set on purpose: browsers forbid it, and the
 * API accepts the login identity purely as signed URL params + the Cider
 * cookies it already sends for kugou.com. The signature key is public
 * (from Meting). No secret of the user's is embedded — the cookie comes
 * from the plugin settings the user pastes in.
 *
 * Never throws; returns "" on any failure (caller falls back to the
 * generic H5 page). A bad/expired cookie just yields "" → silent fallback.
 */

const SIGN_KEY = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const TIMEOUT_MS = 10_000;

interface CookieParts {
  t: string;
  kugouId: string;
  mid: string;
  dfid: string;
}

function parseCookie(cookie: string): CookieParts | null {
  const map = new Map<string, string>();
  for (const pair of String(cookie ?? "").split(";")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  const t = map.get("t") ?? "";
  const kugouId = map.get("KugooID") ?? "";
  if (!t || !kugouId) return null;
  return {
    t,
    kugouId,
    mid: map.get("mid") ?? map.get("kg_mid") ?? "",
    dfid: map.get("dfid") ?? map.get("kg_dfid") ?? "",
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("shortlink timeout")), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

/**
 * Resolve the mixsong short code for a 32-char hash.
 * Prefer `cfg` from plugin settings; `cookieOverride` is for tests.
 */
export async function fetchEncodeId(
  hash: string,
  cookieOverride = ""
): Promise<string> {
  const clean = String(hash ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(clean)) return "";
  let cookie = cookieOverride;
  if (!cookie) {
    try {
      cookie = String(useConfig().kugouCookie ?? "");
    } catch {
      cookie = "";
    }
  }
  const parts = parseCookie(cookie);
  if (!parts) return "";
  try {
    const params: Record<string, string> = {
      srcappid: "2919",
      clientver: "20000",
      clienttime: String(Date.now()),
      mid: parts.mid,
      uuid: parts.mid,
      dfid: parts.dfid,
      appid: "1014",
      platid: "4",
      hash: clean,
      token: parts.t,
      userid: parts.kugouId,
    };
    const sorted = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&")
      .split("&")
      .sort()
      .join("");
    const signature = md5Hex(`${SIGN_KEY}${sorted}${SIGN_KEY}`);
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    const res = await withTimeout(
      fetch(
        `https://wwwapi.kugou.com/play/songinfo?${qs}&signature=${signature}`,
        { credentials: "omit" }
      ),
      TIMEOUT_MS
    );
    if (!res.ok) return "";
    const json = (await res.json()) as {
      data?: { encode_album_audio_id?: unknown };
    };
    const code = String(json?.data?.encode_album_audio_id ?? "").trim();
    return /^[A-Za-z0-9]{4,12}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}
