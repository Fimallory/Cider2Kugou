import qrcode from "qrcode-generator";

/**
 * Visible QR painted at the poster's bottom-right corner.
 * Content is the official chain short link
 * (`m.kugou.com/share/song.html?chain=...`, resolved cookie-free),
 * else the generic H5 share
 * page: any phone scanner (camera, QQ, WeChat) opens it, then the page's
 * own JS wakes the KuGou app when installed (download page when not).
 * White box background keeps it decodable over the busy flow backdrop.
 */

/** QR box edge length (includes quiet zone). Bumped for phone scanning. */
export const QR_SIZE = 220;
/** Margin from the poster right/bottom edges. */
export const QR_MARGIN = 72;
/** Horizontal gap between text and the QR box. */
export const QR_GAP = 24;
/** Quiet-zone modules around the code. */
const QUIET_MODULES = 4;

export function qrBox(): { x: number; y: number; size: number } {
  // Poster is fixed 1080x1350 (see poster.ts POSTER_W/POSTER_H).
  return {
    x: 1080 - QR_MARGIN - QR_SIZE,
    y: 1350 - QR_MARGIN - QR_SIZE,
    size: QR_SIZE,
  };
}

interface QrMatrix {
  n: number;
  cells: Uint8Array;
}

function buildMatrix(text: string): QrMatrix | null {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const cells = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        cells[r * n + c] = qr.isDark(r, c) ? 1 : 0;
      }
    }
    return { n, cells };
  } catch {
    return null;
  }
}

/**
 * Paint a normal (visible, scannable) QR of `text` onto the canvas
 * at the bottom-right corner. No-op returning false when text is empty,
 * encoding fails, or the context is unavailable. Never throws.
 */
export function paintQrOnPoster(
  canvas: HTMLCanvasElement,
  text: string
): boolean {
  if (!text) return false;
  const m = buildMatrix(text);
  if (!m) return false;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
    if (!ctx) return false;
  } catch {
    return false;
  }
  const { x: qx, y: qy } = qrBox();
  const grid = m.n + QUIET_MODULES * 2;
  // Integer-pixel cells: fractional cells shift module edges and surviving
  // decoders reject the code (verified: int-cell decodes, frac-cell fails).
  // Shrink the drawn code to the largest integer cell that fits the plate,
  // centered, plate stays full size.
  const cell = Math.max(1, Math.floor(QR_SIZE / grid));
  const codePx = cell * grid;
  const ox = qx + Math.floor((QR_SIZE - codePx) / 2);
  const oy = qy + Math.floor((QR_SIZE - codePx) / 2);
  try {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Opaque white plate so modules survive the busy backdrop.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(qx, qy, QR_SIZE, QR_SIZE);
    ctx.fillStyle = "#000000";
    for (let r = 0; r < m.n; r++) {
      for (let c = 0; c < m.n; c++) {
        if (m.cells[r * m.n + c] !== 1) continue;
        const px = ox + (QUIET_MODULES + c) * cell;
        const py = oy + (QUIET_MODULES + r) * cell;
        ctx.fillRect(px, py, cell, cell);
      }
    }
    ctx.restore();
    return true;
  } catch {
    try {
      ctx.restore();
    } catch {
      // ignore
    }
    return false;
  }
}
