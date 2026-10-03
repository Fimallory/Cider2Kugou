import { v3 } from "@ciderapp/pluginkit";
import type { SongInfo } from "./song";

interface CatalogSongAttributes {
  name?: string;
  artistName?: string;
  albumName?: string;
  artwork?: { url?: string };
  playParams?: { catalogId?: string; id?: string };
}

interface CatalogSong {
  id: string;
  type: string;
  attributes: CatalogSongAttributes;
}

/**
 * Expand an Apple Music artwork template ({w}/{h}/{f}/{c}) to a concrete URL.
 * Falls back to the raw string when it is already concrete.
 */
export function artworkUrl(template: string, size = 1080): string {
  if (!template) return "";
  return template
    .replace("{w}", String(size))
    .replace("{h}", String(size))
    .replace("{f}", "jpg")
    .replace("{c}", "bb");
}

/**
 * For radio/station/UPC-style ids the catalog endpoint may fail —
 * keep the result optional so callers can fall back to the menu item data.
 *
 * List rows usually carry library ids (e.g. `i.xxx`) with no artwork, so
 * this tries the library route first for those, then the catalog route.
 * Every attempt has a timeout so a hanging host request can never
 * wedge the poster pipeline ("生成卡死").
 */
export async function fetchSongDetail(
  id: string,
  type = "songs",
  catalogId = ""
): Promise<Partial<SongInfo> | null> {
  const cleanId = String(id ?? "").trim();
  const cleanCatalog = String(catalogId ?? "").trim();
  if (!cleanId && !cleanCatalog) return null;
  const t = String(type ?? "songs").trim().toLowerCase() || "songs";

  const routes: string[] = [];
  const pushRoute = (r: string) => {
    if (!routes.includes(r)) routes.push(r);
  };
  // Library ids (non-numeric / explicit library type) -> library route.
  if (t.includes("librar") || (cleanId && !/^\d+$/.test(cleanId))) {
    if (cleanId) pushRoute(`/v1/me/library/songs/${encodeURIComponent(cleanId)}`);
  }
  // Numeric ids -> catalog route.
  const numeric = /^\d+$/.test(cleanCatalog)
    ? cleanCatalog
    : /^\d+$/.test(cleanId)
      ? cleanId
      : "";
  if (numeric) pushRoute(`/v1/catalog/$STOREFRONT/songs/${numeric}`);
  // Library route can also resolve a catalog id's library entry; harmless extra.
  if (!routes.length && cleanId) {
    pushRoute(`/v1/me/library/songs/${encodeURIComponent(cleanId)}`);
  }

  for (const route of routes) {
    try {
      const res = await withTimeout(
        v3<CatalogSong[]>(route),
        10_000,
        `v3 ${route}`
      );
      const song = res?.data?.data?.[0];
      const a = song?.attributes;
      if (!a || (!a.name && !a.artwork?.url)) continue;
      return {
        title: a.name || undefined,
        artist: a.artistName || undefined,
        album: a.albumName || undefined,
        artworkTemplate: a.artwork?.url || undefined,
        id: song.id,
        type: song.type,
        catalogId: a.playParams?.catalogId || undefined,
      };
    } catch {
      // try next route
    }
  }
  return null;
}

/** Race a promise against a timeout so host hangs can't wedge generation. */
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

function loadViaImage(
  src: string,
  cors: boolean,
  timeoutMs = 15_000
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("artwork load timeout")),
      timeoutMs
    );
    const img = new Image();
    // crossOrigin must be set before src to take effect.
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("artwork load failed"));
    };
    img.src = src;
  });
}

/**
 * Load artwork with a hard timeout on every attempt (CORS img, fetch, blob).
 * Rejects instead of hanging forever when a list row has no reachable art.
 */
export async function loadArtwork(
  url: string,
  timeoutMs = 15_000
): Promise<HTMLImageElement> {
  try {
    return await loadViaImage(url, true, timeoutMs);
  } catch {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { mode: "cors", signal: ctrl.signal });
      if (!res.ok) throw new Error(`artwork fetch: ${res.status}`);
      const objUrl = URL.createObjectURL(await res.blob());
      try {
        return await loadViaImage(objUrl, false, timeoutMs);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
