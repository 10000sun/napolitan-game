// ─────────────────────────────────────────────────────────────
// 방명록 물체 그리기
//
// 무엇을 그리든 "뭔가 틀린" 쪽으로 비튼다. 색을 빼고, 누렇게 뜨게 하고,
// 조금 길게 늘이고, 가끔 한 프레임씩 거울에 비친 것처럼 뒤집는다.
// ─────────────────────────────────────────────────────────────

const cache = new Map();   // url → canvas | 'loading' | 'failed'

/** 그릴 수 있게 준비된 캔버스. 아직이거나 실패했으면 null (대체 표시를 쓴다). */
export function sprite(url) {
  if (!url) return null;
  const c = cache.get(url);
  if (c) return typeof c === 'object' ? c : null;
  cache.set(url, 'loading');
  const img = new Image();
  img.onload = () => cache.set(url, url.startsWith('/lib/') ? toCanvas(img) : stripBlack(img));
  img.onerror = () => cache.set(url, 'failed');
  img.src = url;
  return null;
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/** 생성 이미지는 검은 배경 위에 나온다. 네 모서리에서 이어진 어두운 픽셀을 지운다. */
function stripBlack(img, thr = 40) {
  const c = toCanvas(img);
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  const seen = new Uint8Array(w * h);
  const stack = [0, w - 1, (h - 1) * w, h * w - 1];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const o = i * 4;
    if (Math.max(px[o], px[o + 1], px[o + 2]) > thr) continue;
    px[o + 3] = 0;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 같은 물체는 언제나 같은 만큼 늘어나 있다. 1.15 ~ 1.35 */
export function stretchFor(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 1.15 + ((h >>> 0) % 1000) / 1000 * 0.2;
}

const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined'
  && 'filter' in CanvasRenderingContext2D.prototype;

/**
 * 바닥(bottom) 중앙(cx)에 서 있게 그린다.
 * canvas 가 없으면 emoji 를 같은 보정으로 그린다.
 */
export function drawUncanny(c, { canvas, emoji }, cx, bottom, w, h, fog, stretch) {
  c.save();
  if (FILTER_OK) c.filter = `grayscale(.7) sepia(.45) contrast(1.3) brightness(${fog.toFixed(2)})`;
  else c.globalAlpha = fog;
  c.translate(cx, bottom);
  if (Math.random() < 1 / 400) c.scale(-1, 1);        // 한 프레임, 거울 속의 그것
  if (canvas) {
    const ww = Math.min(w * 1.5, h * canvas.width / canvas.height);
    c.drawImage(canvas, -ww / 2, -h * stretch, ww, h * stretch);
  } else if (emoji) {
    c.scale(1, stretch);
    c.font = `${Math.max(6, h * 0.8)}px serif`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillText(emoji, 0, 0);
  }
  c.restore();
}

const emojiCache = new Map();

/** 이모지를 128px 캔버스에. 이미지가 없을 때 대신 쓴다. */
export function emojiCanvas(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '104px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji || '❔', 64, 70);
  emojiCache.set(emoji, c);
  return c;
}

const decalCache = new Map();

/** 벽·바닥에 붙일 픽셀. 기괴 보정을 미리 입힌다. */
export function decalPixels(key, source, emoji) {
  if (decalCache.has(key)) return decalCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (FILTER_OK) g.filter = 'grayscale(.7) sepia(.45) contrast(1.3)';
  g.drawImage(source || emojiCanvas(emoji), 0, 0, 128, 128);
  const out = { data: g.getImageData(0, 0, 128, 128).data, size: 128 };
  decalCache.set(key, out);
  return out;
}

const filteredCache = new Map();
const LEVELS = [1, 0.8, 0.6, 0.42, 0.28, 0.16];

/** 기괴 보정 + 밝기를 미리 입힌 캔버스. 밝기는 몇 단계로 나눠 캐시한다. */
export function filteredCanvas(key, source, brightness = 1) {
  const level = LEVELS.reduce((a, b) => (Math.abs(b - brightness) < Math.abs(a - brightness) ? b : a));
  const k = `${key}|${level}`;
  if (filteredCache.has(k)) return filteredCache.get(k);
  const c = document.createElement('canvas');
  c.width = source.width; c.height = source.height;
  const g = c.getContext('2d');
  if (FILTER_OK) g.filter = `grayscale(.7) sepia(.45) contrast(1.3) brightness(${level})`;
  g.drawImage(source, 0, 0);
  filteredCache.set(k, c);
  return c;
}
