/**
 * Normalized song info used by the poster pipeline.
 * Works for both `AppleMusic.nowPlayingItem` (MediaItem getters)
 * and `addMediaItemContextMenuEntry` item (Resource style).
 */
export interface SongInfo {
  title: string;
  artist: string;
  album: string;
  /** Raw artwork URL template, may contain {w}/{h}/{f}/{c} tokens. */
  artworkTemplate: string;
  id: string;
  type: string;
  /** Catalog id for library items (playParams.catalogId). */
  catalogId: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

/** Artwork may be an object ({url}) or a plain URL string / getter. */
function artString(a: unknown): string {
  if (typeof a === "string") return a.trim();
  if (a && typeof a === "object") return str((a as { url?: unknown }).url);
  return "";
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function tryOne(r: Record<string, unknown>): SongInfo | null {
  // Passthrough: already-normalized SongInfo (e.g. via window stash).
  if (
    typeof r.title === "string" &&
    typeof r.artworkTemplate === "string" &&
    (r.title || r.artworkTemplate || r.id)
  ) {
    return {
      title: (r.title as string) || "Unknown Title",
      artist: str(r.artist) || "Unknown Artist",
      album: str(r.album),
      artworkTemplate: r.artworkTemplate as string,
      id: str(r.id),
      type: str(r.type) || "songs",
      catalogId: str(r.catalogId),
    };
  }

  const attrs = obj(r.attributes) ?? {};
  const pp =
    obj(r.playParams) ?? obj(attrs.playParams) ?? {};

  const title = pick(
    r.title,
    attrs.name,
    r.name,
    attrs.title,
    r.songName,
    r.trackName
  );
  const artist = pick(r.artistName, attrs.artistName, r.artist, attrs.artist);
  const album = pick(
    r.albumName,
    attrs.albumName,
    r.album,
    attrs.album,
    r.collectionName
  );
  const artworkTemplate = pick(
    artString(r.artwork),
    artString(attrs.artwork),
    r.artworkURL,
    attrs.artworkURL,
    r.artworkUrl,
    attrs.artworkUrl,
    r.image,
    r.cover
  );
  const catalogId = pick(pp.catalogId, pp.id);
  const id = pick(r.id, r.songId, r.trackId, r.catalogId, catalogId);
  const type = pick(r.type) || "songs";

  if (!title && !artworkTemplate && !id) return null;

  return {
    title: title || "Unknown Title",
    artist: artist || "Unknown Artist",
    album,
    artworkTemplate,
    id,
    type,
    catalogId,
  };
}

/**
 * Normalize any host song object into a SongInfo.
 * Tries the object itself plus common wrapper keys, then bails out.
 * Returns null when nothing usable can be extracted.
 */
export function normalizeSong(input: unknown): SongInfo | null {
  const root = obj(input);
  if (!root) return null;

  const cands: Record<string, unknown>[] = [root];
  const push = (v: unknown) => {
    const o = obj(v);
    if (o && !cands.includes(o)) cands.push(o);
  };

  push(root.mediaItem);
  push(root._data);
  push(root.rawItem);
  push(root.container);
  push(root.item);
  push(root.song);
  push(root.track);
  push(root.attributes);

  const d = root.data;
  if (Array.isArray(d)) {
    if (d.length) push(d[0]);
  } else {
    push(d);
    const dd = obj(d)?.data;
    if (Array.isArray(dd) && dd.length) push(dd[0]);
  }

  for (const c of cands) {
    const s = tryOne(c);
    if (s) return s;
  }
  return null;
}

/**
 * Track the DOM element that was right-clicked / menu-opened, so the
 * context-menu handler can scrape song info when the host passes an
 * unusable item payload (a MenuItem descriptor instead of song data).
 */
let lastMenuAnchor: HTMLElement | null = null;

function armMenuAnchorTracking(): void {
  if ((window as unknown as { __sharePosterArmed?: boolean }).__sharePosterArmed)
    return;
  (window as unknown as { __sharePosterArmed?: boolean }).__sharePosterArmed = true;
  document.addEventListener(
    "contextmenu",
    (e) => {
      lastMenuAnchor = e.target as HTMLElement | null;
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".menu-btn")) lastMenuAnchor = t;
    },
    true
  );
}

function text(el: ParentNode | null, sel: string): string {
  return el?.querySelector?.(sel)?.textContent?.trim() ?? "";
}

/** Scrape title/artist/album/artwork from a row near the menu anchor. */
function scrapeRow(anchor: HTMLElement): Partial<SongInfo> | null {
  const row =
    anchor.closest?.(
      '.ri-list-item,[data-item-id],.c-listitem-short,.track-item,.song-item,.album-track,[data-media-item],.media-item,.library-song-item'
    ) ?? anchor;
  if (!row) return null;

  const itemId =
    (row as HTMLElement).dataset?.itemId ||
    row.getAttribute?.("data-item-id") ||
    "";
  const itemType =
    (row as HTMLElement).dataset?.itemType ||
    row.getAttribute?.("data-item-type") ||
    "";

  const title = (
    text(row, ".title-section .title-text") ||
    text(row, ".content-title .title-text") ||
    text(row, ".title-section") ||
    text(row, ".track-title") ||
    text(row, ".song-title")
  ).trim();

  let artist =
    text(row, ".artist-section .title-text") ||
    text(row, ".content-artist") ||
    text(row, ".artist-section") ||
    text(row, ".track-artist") ||
    text(row, ".song-artist");
  let album =
    text(row, ".album-section .title-text") ||
    text(row, ".content-album") ||
    text(row, ".album-section");

  // Album view: artist/album live in the header, not the track row.
  const view = row.closest?.(".album-view, .artist-view") ?? null;
  if ((!artist || !album) && view) {
    artist =
      artist ||
      text(view, ".artist-chips .chip-name") ||
      text(view, ".album-header .artist") ||
      text(view, ".album-artist");
    album =
      album ||
      text(view, ".album-details .title .title-text") ||
      text(view, ".album-header .album-title") ||
      text(view, ".album-name");
  }
  // Search results: description block holds artist + album subtitles.
  if ((!artist || !album) && typeof row.closest === "function") {
    const desc = row.closest(".description");
    if (desc) {
      const subs = [...desc.querySelectorAll(".subtitle")].map((s) =>
        s.textContent?.trim()
      );
      if (subs.length) {
        album = album || subs[0] || "";
        const links = desc.querySelectorAll(".artistLink.subtitle");
        const last = links[links.length - 1];
        artist = artist || last?.textContent?.trim() || subs[subs.length - 1] || "";
      }
    }
  }

  let artwork = "";
  const imgs = row.querySelectorAll?.("img") ?? [];
  for (const im of imgs) {
    const src = (im as HTMLImageElement).currentSrc || (im as HTMLImageElement).src || "";
    if (src && !src.startsWith("data:")) {
      artwork = src;
      break;
    }
  }
  // Album header picture source often has the highest quality URL.
  if (!artwork && view) {
    const src = view.querySelector?.(".album-artwork picture source, .album-header picture source");
    const set = src?.getAttribute?.("srcset") ?? "";
    if (set && !set.includes("data:")) artwork = set.split(" ")[0].split(",")[0];
  }

  if (!title && !artwork && !itemId) return null;
  return {
    title: title || undefined,
    artist: artist || undefined,
    album: album || undefined,
    artworkTemplate: artwork || undefined,
    id: itemId || undefined,
    type: itemType || undefined,
  };
}

/** Currently playing track via RPC attrs (MKLite mode) or MediaItem store. */
function nowPlayingViaStore(): Partial<SongInfo> | null {
  try {
    const cider = (window as unknown as { CiderApp?: any }).CiderApp;
    const attrs =
      cider?.RPC?.nowPlayingAttributes ??
      cider?.rpc?.nowPlayingAttributes ??
      null;
    if (attrs) {
      return {
        title: str(attrs.name),
        artist: str(attrs.artistName),
        album: str(attrs.albumName),
        artworkTemplate: str(attrs.artwork?.url),
        id: str(attrs.playParams?.id ?? attrs.playParams?.catalogId ?? attrs.id),
        type: str(attrs.playParams?.kind),
        catalogId: str(attrs.playParams?.catalogId),
      };
    }
    const store = (
      window as unknown as { __PLUGINSYS__?: { Stores?: Record<string, any> } }
    ).__PLUGINSYS__?.Stores;
    const np = store?.appleMusicStore?.nowPlayingItem ?? null;
    if (np) {
      const a = (np as { attributes?: Record<string, unknown> }).attributes ?? {};
      return {
        title: str((np as { title?: unknown }).title) || str(a.name),
        artist: str((np as { artistName?: unknown }).artistName) || str(a.artistName),
        album: str((np as { albumName?: unknown }).albumName) || str(a.albumName),
        artworkTemplate:
          str((np as { artwork?: { url?: unknown } }).artwork?.url) ||
          str((a.artwork as { url?: unknown } | undefined)?.url),
        id: str((np as { id?: unknown }).id),
        type: str((np as { type?: unknown }).type),
      };
    }
  } catch {
    // ignore — caller falls through to the alert
  }
  return null;
}

/**
 * Resolve the best SongInfo for a menu click:
 * 1) host item payload, 2) DOM scrape near the click, 3) now playing store.
 */
export function resolveSongForShare(item: unknown): SongInfo | null {
  const fromItem = normalizeSong(item);
  if (fromItem && fromItem.title !== "Unknown Title") return fromItem;

  if (lastMenuAnchor && lastMenuAnchor.isConnected !== false) {
    const scraped = scrapeRow(lastMenuAnchor);
    if (scraped && (scraped.title || scraped.artworkTemplate || scraped.id)) {
      return {
        title: scraped.title || "Unknown Title",
        artist: scraped.artist || "Unknown Artist",
        album: scraped.album || "",
        artworkTemplate: scraped.artworkTemplate || "",
        id: scraped.id || "",
        type: scraped.type || "songs",
        catalogId: scraped.catalogId || "",
      };
    }
  }

  const np = nowPlayingViaStore();
  if (np && (np.title || np.artworkTemplate || np.id)) {
    return {
      title: np.title || "Unknown Title",
      artist: np.artist || "Unknown Artist",
      album: np.album || "",
      artworkTemplate: np.artworkTemplate || "",
      id: np.id || "",
      type: np.type || "songs",
      catalogId: np.catalogId || "",
    };
  }

  return fromItem;
}

export { armMenuAnchorTracking };

/** One-line shape summary for DevTools diagnosis (no circular refs). */
export function describeSource(input: unknown): string {
  try {
    const root = obj(input);
    if (!root) return input === null ? "null" : typeof input;
    const keys = Object.keys(root);
    const attrs =
      obj(root.attributes) ??
      obj(obj(root.mediaItem)?.attributes) ??
      obj(obj(root._data)?.attributes);
    const akeys = attrs ? Object.keys(attrs) : [];
    const ctor = (root as { constructor?: { name?: string } }).constructor
      ?.name;
    return `keys=[${keys.join(",")}] attrs=[${akeys.join(",")}] ctor=${ctor ?? "?"}`;
  } catch {
    return "?";
  }
}
