import type { SongInfo } from "./song";
import { artworkUrl, loadArtwork } from "./artwork";

export const POSTER_W = 1080;
export const POSTER_H = 1350;

/** Crisp cover block at the top (square, full bleed). */
const COVER_SIZE = 1080;
const COVER_Y = 0;
/** Cover dissolves into the flow between these Y coords (alpha 1 -> 0). */
const FADE_START = 780;
const FADE_END = COVER_SIZE;
const TEXT_TOP = 1060;
const PAD_X = 72;
const MAX_TEXT_W = POSTER_W - PAD_X * 2;

function coverFit(
  img: HTMLImageElement,
  cw: number,
  ch: number
): { dx: number; dy: number; dw: number; dh: number } {
  const w = img.naturalWidth || cw;
  const h = img.naturalHeight || ch;
  const s = Math.max(cw / w, ch / h);
  const dw = w * s;
  const dh = h * s;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

/**
 * Flowing backdrop, Spicetify full-screen style with randomized flavor:
 * the same cover fills the whole poster (cover-fit, centered),
 * heavily blurred + brightness pulled down + saturation pushed up.
 *
 * Two randomized touches per render (fresh random seed every call, so
 * hitting "重新生成" yields a different flow each time):
 * 1) the crop window slides along the dominant axis (±6%), so renders
 *    surface different parts of the artwork instead of a dead-center copy;
 * 2) the flow is rebuilt from 3 staggered slices of the cover bottom
 *    (mirrored + offset + rotated slightly), composited UNDER the regular
 *    blurred wash — the bottom is a remix of the artwork, not a plain
 *    stretched copy.
 *
 * Overscan margins hide the transparent fade that blur creates at edges.
 */
function paintFlowingBackdrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  seed: number
): void {
  const rand = mulberry32(seed >>> 0);

  const tile = document.createElement("canvas");
  tile.width = 270;
  tile.height = 338; // 1080x1350 @ 1/4, same aspect as the poster
  const tctx = tile.getContext("2d");
  if (!tctx) {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    return;
  }

  // Base wash: full cover, blurred. Slide the crop window along the
  // dominant axis so the flow isn't always the center slice.
  const w = img.naturalWidth || tile.width;
  const h = img.naturalHeight || tile.height;
  const s = Math.max(tile.width / w, tile.height / h);
  const dw = w * s;
  const dh = h * s;
  const wide = dw > dh;
  const slide = (rand() - 0.5) * 2 * 0.06; // ±6%
  const dx = wide ? (tile.width - dw) / 2 + slide * tile.width : (tile.width - dw) / 2;
  const dy = wide ? (tile.height - dh) / 2 : (tile.height - dh) / 2 + slide * tile.height;
  tctx.drawImage(img, dx, dy, dw, dh);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "blur(28px) brightness(0.8) saturate(1.7)";
  const m = 120; // overscan: blur shrinks edges, draw past the canvas
  ctx.drawImage(tile, -m, -m, POSTER_W + m * 2, POSTER_H + m * 2);
  ctx.restore();

  // Remix layer: bottom slices of the cover, each mirrored / offset /
  // rotated differently, blurred hard and laid over the wash only in the
  // lower half. Same hue family, but the texture is reshuffled.
  paintRemixFlow(ctx, img, rand);
}

/**
 * Rebuild the lower flow from staggered cover slices.
 * Bands tile the layer seamlessly (slot-centered, overlapped), each mirrored
 * / offset / rotated differently, then blurred into the wash.
 * The layer's top edge is feathered so no line appears where it begins.
 */
function paintRemixFlow(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rand: () => number
): void {
  const S = 270; // working resolution (x4 = poster scale)
  const sq = document.createElement("canvas");
  sq.width = S;
  sq.height = S;
  const qctx = sq.getContext("2d");
  if (!qctx) return;
  const r = coverFit(img, S, S);
  qctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);

  const layer = document.createElement("canvas");
  layer.width = S;
  layer.height = Math.round((S * (POSTER_H - 560)) / POSTER_W); // flow zone ~ lower half
  const lctx = layer.getContext("2d");
  if (!lctx) return;

  const bands = 3;
  const srcH = S * 0.4; // bottom 40% of the cover
  const srcBand = srcH / bands;
  const dstBand = layer.height / bands;
  const overlap = 6; // small-scale px; blur erases it, gaps would survive
  for (let i = 0; i < bands; i++) {
    const jitter = (rand() - 0.5) * 8;
    const rawSrcY = S - srcH + i * srcBand + jitter;
    const srcY = Math.min(Math.max(rawSrcY, S - srcH), S - srcBand);
    // Random horizontal mirror + offset + slight rotation per band.
    const mirror = rand() > 0.5;
    const offX = (rand() - 0.5) * S * 0.3;
    const rot = (rand() - 0.5) * 0.16; // ±~4.5°
    const dstY = i * dstBand;

    lctx.save();
    lctx.translate(S / 2 + offX, dstY + dstBand / 2);
    lctx.rotate(rot);
    if (mirror) lctx.scale(-1, 1);
    // Drawn 2x wide so rotation never exposes empty corners;
    // overlapped vertically so no transparent seams between bands.
    lctx.drawImage(sq, 0, srcY, S, srcBand, -S, -dstBand / 2 - overlap, S * 2, dstBand + overlap * 2);
    lctx.restore();
  }

  // Feather the layer's top edge: transparent -> opaque over the top 30%,
  // so the remix melts into the wash instead of starting with a line.
  lctx.globalCompositeOperation = "destination-in";
  const feather = lctx.createLinearGradient(0, 0, 0, layer.height * 0.3);
  feather.addColorStop(0, "rgba(0,0,0,0)");
  feather.addColorStop(1, "rgba(0,0,0,1)");
  lctx.fillStyle = feather;
  lctx.fillRect(0, 0, S, layer.height);
  lctx.globalCompositeOperation = "source-over";

  // Blend the remix into the wash: hard blur + only the lower poster half.
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "blur(18px) brightness(0.92) saturate(1.5)";
  const topY = 560;
  const m = 60;
  ctx.drawImage(layer, -m, topY - m, POSTER_W + m * 2, POSTER_H - topY + m * 2);
  ctx.restore();
}

/** Deterministic PRNG (seeded per render call). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw the sharp cover with a feathered bottom edge (alpha 1 -> 0).
 * No hard line: at COVER bottom only the blurred flow remains,
 * the two dissolve into each other instead of stacking as layers.
 */
function paintCoverWithFade(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement
): void {
  const c = document.createElement("canvas");
  c.width = COVER_SIZE;
  c.height = COVER_SIZE;
  const cctx = c.getContext("2d");
  if (!cctx) {
    const r = coverFit(img, COVER_SIZE, COVER_SIZE);
    ctx.drawImage(img, r.dx, COVER_Y + r.dy, r.dw, r.dh);
    return;
  }
  const r = coverFit(img, COVER_SIZE, COVER_SIZE);
  cctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
  // Feather the bottom: opaque until FADE_START, transparent at the edge.
  cctx.globalCompositeOperation = "destination-in";
  const mask = cctx.createLinearGradient(0, FADE_START, 0, FADE_END);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  cctx.fillStyle = mask;
  cctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  cctx.globalCompositeOperation = "source-over";
  ctx.drawImage(c, 0, COVER_Y);
}

function paintLegibility(ctx: CanvasRenderingContext2D): void {
  // Single feathered shade behind the text only. Top alpha is 0,
  // so there is no visible band edge where the rect starts.
  const top = 900;
  const g = ctx.createLinearGradient(0, top, 0, POSTER_H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, top, POSTER_W, POSTER_H - top);
}

function ellipsis(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number
): string {
  const t = String(text ?? "");
  if (!t || ctx.measureText(t).width <= max) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

function paintText(ctx: CanvasRenderingContext2D, song: SongInfo): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 2;

  let y = TEXT_TOP + 60;

  ctx.fillStyle = "#ffffff";
  ctx.font =
    '700 76px -apple-system, "SF Pro Display", Inter, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  ctx.fillText(ellipsis(ctx, song.title, MAX_TEXT_W), PAD_X, y);

  y += 64;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font =
    '500 44px -apple-system, "SF Pro Text", Inter, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  ctx.fillText(ellipsis(ctx, song.artist, MAX_TEXT_W), PAD_X, y);

  if (song.album) {
    y += 52;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font =
      '400 36px -apple-system, "SF Pro Text", Inter, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    ctx.fillText(ellipsis(ctx, song.album, MAX_TEXT_W), PAD_X, y);
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Neutral dark placeholder so generation never blocks on missing artwork.
 * Text labels are left to paintText; this only fills the cover area.
 */
function paintPlaceholderCover(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, COVER_SIZE);
  g.addColorStop(0, "#23262e");
  g.addColorStop(1, "#101216");
  ctx.fillStyle = g;
  ctx.fillRect(0, COVER_Y, COVER_SIZE, COVER_SIZE);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = '400 120px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♪", COVER_SIZE / 2, COVER_SIZE / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Render the 1080x1350 poster.
 * Missing/unreachable artwork falls back to a neutral placeholder cover —
 * generation never hangs or throws on artwork alone.
 */
export async function renderPoster(song: SongInfo): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  const url = artworkUrl(song.artworkTemplate, 1080);
  let img: HTMLImageElement | null = null;
  if (url) {
    try {
      img = await loadArtwork(url);
    } catch {
      img = null;
    }
  }

  if (img) {
    // Fresh random seed per render: "重新生成" gives a new flow each time.
    const seed =
      (Date.now() % 2147483647) ^ ((Math.random() * 0xffffffff) >>> 0);
    // 1) blurred cover fills everything = the flow (remixed per render)
    paintFlowingBackdrop(ctx, img, seed);

    // 2) crisp cover on top, bottom feathered into the flow (no hard seam)
    paintCoverWithFade(ctx, img);
  } else {
    // No artwork (list rows, radio, failed fetch): neutral placeholder flow.
    ctx.fillStyle = "#14161b";
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    paintPlaceholderCover(ctx);
  }

  // 3) one feathered shade behind the text (transparent at the top edge)
  paintLegibility(ctx);

  // 4) title / artist / album
  paintText(ctx, song);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png"
    );
  });
}

/**
 * Copy a PNG blob to the system clipboard.
 * Must be called inside the click gesture chain — pass the blob promise
 * straight into ClipboardItem so transient activation is preserved.
 */
export async function copyPngToClipboard(blob: Blob | Promise<Blob>): Promise<void> {
  if (!window.isSecureContext || !navigator.clipboard?.write) {
    throw new Error("clipboard unavailable");
  }
  const item = new ClipboardItem({ "image/png": blob });
  await navigator.clipboard.write([item]);
}

/** Last-resort fallback when clipboard write is denied: download the PNG. */
export function downloadPng(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function posterFileName(song: SongInfo): string {
  const safe = (s: string) =>
    s.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "poster";
  return `${safe(song.artist)} - ${safe(song.title)}.png`;
}
