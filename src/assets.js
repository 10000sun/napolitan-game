// ─────────────────────────────────────────────────────────────
// 방명록 물체의 모습
//
// 물체가 적히는 순간 한 번만 모습을 정한다. 플레이 중에는 부르지 않는다.
//   1) 같은 물체를 이미 봤으면 그걸 쓴다
//   2) 가진 에셋(라이브러리 + 전에 만든 것) 중 태그가 충분히 겹치면 그걸 쓴다
//   3) 없으면 만든다. Gemini 가 하루 한도를 넘으면 그날은 Pollinations
//   4) 그래도 안 되면 포기한다. 화면에는 이모지가 대신 선다
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY_DIR = path.join(ROOT, 'assets', 'library');
const LIBRARY_JSON = path.join(ROOT, 'assets', 'library.json');
export const assetDir = () => process.env.ASSET_DIR || path.join(ROOT, 'data', 'assets');

const MATCH_MIN = 0.5;
export const STYLE = 'single object, centered, isolated on plain pure black background, uncanny, '
  + 'subtly wrong proportions, desaturated, grainy found photograph, unsettling, no text';

/** 줍는 아이템의 바닥 모습. 태그는 고정. */
export const ITEM_ASSETS = {
  pistol: { key: 'item:pistol', name: '권총', tags: ['pistol', 'handgun', 'rusty'] },
  knife: { key: 'item:knife', name: '칼', tags: ['knife', 'kitchen knife', 'bloody'] },
  map: { key: 'item:map', name: '지도', tags: ['map', 'paper', 'crumpled'] },
};

/** Task 4 에서 채운다. */
export const GENERATORS = {};

/** 태그 겹침(Jaccard)으로 가장 비슷한 것. 빈 태그는 아무것과도 맞지 않는다. */
export function matchTags(tags, candidates) {
  const a = new Set(tags);
  let best = { entry: null, score: 0 };
  if (!a.size) return best;
  for (const c of candidates) {
    const b = new Set(c.tags);
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const score = inter / (a.size + b.size - inter);
    if (score > best.score) best = { entry: c, score };
  }
  return best;
}

export function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_JSON, 'utf8'))
      .map((e) => ({ tags: e.tags, file: `/lib/${e.file}` }));
  } catch {
    return [];
  }
}

const hashKey = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);

/** 오늘 무엇으로 만들지. Gemini 가 한도를 넘었으면 Pollinations 만. */
function generatorOrder(now) {
  const provider = (process.env.IMAGE_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'none') return [];
  if (provider === 'pollinations') return ['pollinations'];
  const limit = Number(process.env.IMAGE_DAILY_LIMIT ?? 20);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const used = q.generatedSince.get('gemini', midnight.getTime()).n;
  return used < limit ? ['gemini', 'pollinations'] : ['pollinations'];
}

const inflight = new Map();

/** 물체의 모습을 확보한다. 같은 key 를 동시에 불러도 한 번만 만든다. */
export function resolveAsset(obj, opts = {}) {
  if (inflight.has(obj.key)) return inflight.get(obj.key);
  const p = doResolve(obj, opts).finally(() => inflight.delete(obj.key));
  inflight.set(obj.key, p);
  return p;
}

async function doResolve(obj, { generators = GENERATORS, library = loadLibrary(), now = Date.now(), dir = assetDir() } = {}) {
  const hit = q.assetByKey.get(obj.key);
  if (hit) return hit;

  const save = (source, file, status) => {
    q.insertAsset.run(obj.key, obj.tags.join(','), source, file, status, now);
    return q.assetByKey.get(obj.key);
  };

  const pool = [...library, ...q.readyAssets.all().map((r) => ({ tags: r.tags.split(','), file: r.file }))];
  const m = matchTags(obj.tags, pool);
  if (m.score >= MATCH_MIN) return save('match', m.entry.file, 'ready');

  const prompt = `${(obj.tags.length ? obj.tags : [obj.name]).join(', ')}, ${STYLE}`;
  for (const name of generatorOrder(now)) {
    try {
      if (!generators[name]) throw new Error('생성기가 없습니다');
      const img = await generators[name](prompt);
      const file = `${hashKey(obj.key)}.${img.ext}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), img.data);
      return save(name, `/obj/${file}`, 'ready');
    } catch (e) {
      console.error(`[asset:${name}]`, obj.key, e.message);
    }
  }
  return save('none', null, 'failed');
}

/**
 * 런 시작 때 붙일 URL. 준비 안 됐거나 생성 파일이 사라졌으면 null → 화면에는 대체 표시.
 * 라이브러리 파일은 운영자가 직접 관리하므로 확인하지 않는다 (없으면 클라이언트 onerror 로 떨어진다).
 */
export function imgFor(key) {
  const a = q.assetByKey.get(key);
  if (a?.status !== 'ready' || !a.file) return null;
  if (a.file.startsWith('/obj/') && !fs.existsSync(path.join(assetDir(), path.basename(a.file)))) return null;
  return a.file;
}
