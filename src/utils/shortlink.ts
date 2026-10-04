import { md5Hex } from "./md5";

/**
 * Resolve the official `?chain=` short code via `tservice.kugou.com/app/`
 * (Web-end share flow, reversed from `hashQueryShortUrl`):
 * `md5 = MD5(UPPER(hash) + "kgclientshare")`.
 *
 * No Cookie needed, CORS `*` — plain browser fetch works.
 * Never throws; returns "" on any failure (caller falls back to H5).
 */

const TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("chain timeout")), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

/** Extract `chain` from `https://m.kugou.com/share/song.html?chain=XXX`. */
function extractChain(data: string): string {
  const m = String(data ?? "").match(/[?&]chain=([A-Za-z0-9]+)/);
  const code = (m?.[1] ?? "").trim();
  return /^[A-Za-z0-9]{4,16}$/.test(code) ? code : "";
}

export interface ChainInput {
  hash: string;
  albumId: string;
  albumAudioId: string;
  /** `歌手 - 歌名`，对应 Web 端 `audio_name`。 */
  filename: string;
}

/**
 * Fetch the `?chain=` short code for a 32-char hash.
 * `filename` mismatch does not block issuing; hash is the key.
 */
export async function fetchChain(input: ChainInput): Promise<string> {
  const hash = String(input?.hash ?? "").trim();
  if (!/^[a-fA-F0-9]{32}$/.test(hash)) return "";
  const upper = hash.toUpperCase();
  const albumId = String(input?.albumId ?? "").trim() || "0";
  const albumAudioId = String(input?.albumAudioId ?? "").trim();
  const filename = String(input?.filename ?? "").trim();
  const md5 = md5Hex(upper + "kgclientshare");
  const q = new URLSearchParams({
    cmid: "1",
    filename,
    hash: upper,
    album_id: albumId,
    album_audio_id: albumAudioId,
    is_short: "1",
    md5,
    chl: "qq",
    codes: "1",
    from: "",
  });
  try {
    const res = await withTimeout(
      fetch(`https://tservice.kugou.com/app/?${q.toString()}`, {
        credentials: "omit",
        referrer: "https://www.kugou.com/",
      }),
      TIMEOUT_MS
    );
    if (!res.ok) return "";
    const text = (await res.text()).trim();
    // No `callback` param → pure JSON body.
    const json = JSON.parse(text) as { status?: unknown; data?: unknown };
    if (json?.status !== 1) return "";
    return extractChain(String(json?.data ?? ""));
  } catch {
    return "";
  }
}
