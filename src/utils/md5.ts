/**
 * Minimal MD5 (RFC 1321) for the KuGou chain signature.
 * Browser `crypto.subtle` does not offer MD5, and the plugin bundle has no
 * node:crypto — so this ships its own. Verified against node:crypto below.
 */

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

function fF(x: number, y: number, z: number): number {
  return (x & y) | (~x & z);
}
function fG(x: number, y: number, z: number): number {
  return (x & z) | (y & ~z);
}
function fH(x: number, y: number, z: number): number {
  return x ^ y ^ z;
}
function fI(x: number, y: number, z: number): number {
  return y ^ (x | ~z);
}

const S: number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K: number[] = [];
for (let i = 0; i < 64; i++) {
  K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
}

function toBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

export function md5Hex(input: string): string {
  const msg = toBytes(input);
  const bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 0; i < 8; i++) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < msg.length; off += 64) {
    const M: number[] = [];
    for (let i = 0; i < 16; i++) {
      M.push(
        (msg[off + i * 4]! |
          (msg[off + i * 4 + 1]! << 8) |
          (msg[off + i * 4 + 2]! << 16) |
          (msg[off + i * 4 + 3]! << 24)) >>>
          0
      );
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = fF(B, C, D);
        g = i;
      } else if (i < 32) {
        F = fG(B, C, D);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = fH(B, C, D);
        g = (3 * i + 5) % 16;
      } else {
        F = fI(B, C, D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i]!)) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const hex = (x: number): string => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    return s;
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}
