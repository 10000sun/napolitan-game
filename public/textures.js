// ─────────────────────────────────────────────────────────────
// 표면
//
// 벽·바닥·천장·문. 방명록이 바꾼 질감 → 기본 사진(ambientCG) → 코드로 만든 것.
// 사진은 누렇게 뜨고 얼룩이 앉는다. 깨끗한 곳은 여기 없다.
// 순수 함수는 node 에서도 돈다. buildSurfaces 만 브라우저 전용이다.
// ─────────────────────────────────────────────────────────────

export const TEX = 256;
export const TONE = { wall: [216, 199, 122], floor: [184, 163, 106], ceil: [230, 221, 176], door: [255, 255, 255] };
const BASE = { wall: [196, 180, 112], floor: [150, 132, 88], ceil: [214, 206, 170], door: [120, 112, 100], light: [246, 244, 226] };

function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 주기 period 로 이어지는 value noise. 0~1 */
export function noise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const w = (i) => ((i % period) + period) % period;
  const v = (i, j) => hash2(w(i), w(j), seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function fbm(u, v, base, seed) {
  let s = 0, amp = 0.5, f = base;
  for (let o = 0; o < 4; o++) { s += amp * noise(u * f, v * f, f, seed + o); amp /= 2; f *= 2; }
  return s / 0.9375;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** 코드로 만든 표면. 파일이 없거나 방명록이 색만 정했을 때. */
export function procedural(surface, color) {
  const px = new Uint8ClampedArray(TEX * TEX * 4);
  const base = hexToRgb(color) || BASE[surface] || BASE.wall;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX, v = y / TEX;
      const grime = fbm(u, v, 4, 7);
      const grain = fbm(u, v, 32, 3);
      let k = 0.75 + 0.35 * grain - 0.45 * Math.max(0, grime - 0.45);
      if (surface === 'wall') {
        k *= 0.93 + 0.07 * Math.sin(u * Math.PI * 2 * 12);   // 세로 줄무늬 (12줄이라 이음새가 맞는다)
        if (v > 0.88) k *= 0.55;                             // 걸레받이
      } else if (surface === 'ceil') {
        if ((u * 2) % 1 < 0.03 || (v * 2) % 1 < 0.03) k *= 0.45;   // 타일 틈
      } else if (surface === 'door') {
        if (Math.abs(u - 0.8) < 0.04 && Math.abs(v - 0.52) < 0.03) k = 1.6;   // 손잡이
      } else if (surface === 'light') {
        k = 0.92 + 0.08 * grain;
      }
      const i = (y * TEX + x) * 4;
      px[i] = base[0] * k; px[i + 1] = base[1] * k; px[i + 2] = base[2] * k; px[i + 3] = 255;
    }
  }
  return px;
}

/** 사진에 톤을 곱하고 얼룩을 입힌다. amount 0 이면 톤만. */
export function tintGrime(px, rgb, amount = 0.45) {
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const g = amount ? fbm(x / TEX, y / TEX, 4, 11) : 0;
      const k = 1 - amount * Math.max(0, g - 0.4);
      const i = (y * TEX + x) * 4;
      px[i] = px[i] * rgb[0] / 255 * k;
      px[i + 1] = px[i + 1] * rgb[1] / 255 * k;
      px[i + 2] = px[i + 2] * rgb[2] / 255 * k;
    }
  }
  return px;
}

/* ── 브라우저 전용 ─────────────────────────────────── */

const loadImg = (url) => new Promise((ok) => {
  if (!url) { ok(null); return; }
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => ok(null);
  i.src = url;
});

function pixelsOf(img, crop, filter) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  if (filter) g.filter = filter;
  if (crop) g.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, TEX, TEX);
  else g.drawImage(img, 0, 0, TEX, TEX);
  return g.getImageData(0, 0, TEX, TEX).data;
}

export function canvasOf(px) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), TEX, TEX), 0, 0);
  return c;
}

/** 표면 텍스처 다섯 장 (wall, floor, ceil, door, light) + 문 캔버스. */
export async function buildSurfaces(surfaces = {}) {
  const out = {};
  for (const s of ['wall', 'floor', 'ceil', 'door']) {
    const look = surfaces[s];
    const custom = await loadImg(look?.img);
    if (custom) { out[s] = pixelsOf(custom, null, 'grayscale(.4) sepia(.35) contrast(1.15)'); continue; }
    const photo = (s === 'ceil' || look?.color) ? null : await loadImg(`/tex/${s}.jpg`);
    out[s] = photo ? tintGrime(pixelsOf(photo), TONE[s], s === 'door' ? 0.1 : 0.45) : procedural(s, look?.color);
  }
  const panel = await loadImg('/tex/ceil.jpg');
  out.light = panel ? pixelsOf(panel, [8, 8, 72, 72]) : procedural('light');
  out.doorCanvas = canvasOf(out.door);
  return out;
}
