// 에셋 해석기. 네트워크 없이 가짜 생성기를 끼워서 흐름만 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napo-assets-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ASSET_DIR = path.join(tmp, 'obj');
process.env.IMAGE_PROVIDER = 'gemini';
process.env.IMAGE_DAILY_LIMIT = '2';

const { matchTags, resolveAsset, imgFor } = await import('../src/assets.js');
const { q } = await import('../src/db.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

const PNG = { data: Buffer.alloc(200, 1), ext: 'png' };
const calls = [];
const gen = (name, ok = true) => async (prompt) => {
  calls.push({ name, prompt });
  if (!ok) throw new Error(`${name} 실패`);
  return PNG;
};
const gens = { gemini: gen('gemini'), pollinations: gen('pollinations') };
const obj = (name, tags) => ({ key: name, name, tags });

// ── 매칭 ────────────────────────────────────────────────
const lib = [{ tags: ['slime', 'green'], file: '/lib/slime.png' }, { tags: ['mask'], file: '/lib/mask.png' }];
check(matchTags(['slime', 'green'], lib).entry.file === '/lib/slime.png', '태그가 같으면 그 에셋');
check(matchTags(['slime', 'water'], lib).score < 0.5, '반만 겹치면 0.5 미만 (1/3)');
check(matchTags(['mask', 'smiling'], lib).score === 0.5, '경계값 0.5');
check(matchTags([], lib).score === 0 && matchTags([], [{ tags: [], file: 'x' }]).score === 0,
  '빈 태그는 아무것과도 매칭되지 않는다');

// ── 흐름 ────────────────────────────────────────────────
let r = await resolveAsset(obj('웃는 가면', ['mask', 'smiling']), { generators: gens, library: lib });
check(r.status === 'ready' && r.file === '/lib/mask.png' && r.source === 'match', '라이브러리 매칭이면 생성하지 않는다');
check(calls.length === 0, '생성기 호출 0회');

r = await resolveAsset(obj('젤리', []), { generators: gens, library: lib });
check(r.source === 'gemini' && /^\/obj\/[0-9a-f]{16}\.png$/.test(r.file), '매칭이 없으면 gemini 로 생성, 파일명은 해시');
check(fs.existsSync(path.join(process.env.ASSET_DIR, path.basename(r.file))), '파일이 실제로 저장된다');
check(calls[0].prompt.startsWith('젤리, ') && calls[0].prompt.includes('uncanny'), '태그가 없으면 이름 + 고정 화풍');

calls.length = 0;
r = await resolveAsset(obj('젤리', []), { generators: gens, library: lib });
check(calls.length === 0 && r.source === 'gemini', '같은 key 는 캐시에서');

r = await resolveAsset(obj('slime', ['slime', 'green']), { generators: gens, library: [] });
check(r.source === 'gemini', '두 번째 gemini 생성');
r = await resolveAsset(obj('green slime', ['slime', 'green']), { generators: gens, library: [] });
check(r.source === 'match' && r.file === q.assetByKey.get('slime').file, '생성한 에셋도 다음 매칭 대상이 된다');

calls.length = 0;
r = await resolveAsset(obj('눈알', ['eyeball']), { generators: gens, library: [] });
check(r.source === 'pollinations' && calls.map((c) => c.name).join() === 'pollinations',
  '일일 한도(2)를 넘으면 pollinations 로');

r = await resolveAsset(obj('다음날 눈알', ['eyeball2']), { generators: gens, library: [], now: Date.now() + 86_400_000 });
check(r.source === 'gemini', '다음 날이면 다시 gemini');

calls.length = 0;
r = await resolveAsset(obj('손', ['hand']), {
  generators: { gemini: gen('gemini', false), pollinations: gen('pollinations', false) }, library: [],
  now: Date.now() + 2 * 86_400_000,
});
check(r.status === 'failed' && r.file === null, '전부 실패하면 failed');
check(calls.map((c) => c.name).join() === 'gemini,pollinations', 'gemini 실패 → pollinations 시도');

calls.length = 0;
const [a, b] = await Promise.all([
  resolveAsset(obj('동시', ['same']), { generators: gens, library: [], now: Date.now() + 3 * 86_400_000 }),
  resolveAsset(obj('동시', ['same']), { generators: gens, library: [], now: Date.now() + 3 * 86_400_000 }),
]);
check(calls.length === 1 && a.file === b.file, '같은 key 를 동시에 요청해도 생성은 한 번');

process.env.IMAGE_PROVIDER = 'none';
r = await resolveAsset(obj('안만듦', ['nothing']), { generators: gens, library: [] });
check(r.status === 'failed' && !q.assetByKey.get('안만듦'), 'IMAGE_PROVIDER=none 이면 실패를 남기지 않는다 (나중에 켜면 다시 시도)');
process.env.IMAGE_PROVIDER = 'gemini';

// ── imgFor ──────────────────────────────────────────────
check(imgFor('웃는 가면') === '/lib/mask.png', 'ready 면 URL');
check(imgFor('손') === null && imgFor('없는것') === null, 'failed·없음이면 null');
const jelly = q.assetByKey.get('젤리').file;
fs.rmSync(path.join(process.env.ASSET_DIR, path.basename(jelly)));
check(imgFor('젤리') === null, '파일이 지워졌으면 null');

// ── 생성기 어댑터 (fetch 가로채기) ───────────────────────
const { GENERATORS, toImage } = await import('../src/assets.js');
const { tagsFromFilename } = await import('../scripts/tag-assets.js');
const realFetch = globalThis.fetch;
let reply = null, lastUrl = '', lastOpts = {}, lastBody = null;
globalThis.fetch = async (url, opts = {}) => {
  lastUrl = String(url); lastOpts = opts; lastBody = opts.body ? JSON.parse(opts.body) : null; return reply();
};
const fails = (p) => p.then(() => false, () => true);

const pngB64 = Buffer.alloc(300, 7).toString('base64');
process.env.GEMINI_API_KEY = 'k';
reply = () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [
  { type: 'text', text: 'hi' }, { type: 'image', data: pngB64, mime_type: 'image/png' }] }] }), { status: 200 });
let img = await GENERATORS.gemini('mask, uncanny');
check(img.ext === 'png' && img.data.length === 300, 'gemini: Interactions 응답의 image 를 꺼낸다');
check(lastUrl.endsWith('/v1beta/interactions') && lastBody.input === 'mask, uncanny'
  && lastBody.model === 'gemini-3.1-flash-lite-image', 'gemini: 모델과 프롬프트가 본문에');
check(lastOpts.headers['x-goog-api-key'] === 'k', 'gemini: 키는 헤더로');

reply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pngB64 } }] } }] }), { status: 200 });
check((await GENERATORS.gemini('x')).ext === 'png', 'gemini: generateContent 모양의 응답도 읽는다');

reply = () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '거절' }] }] }), { status: 200 });
check(await fails(GENERATORS.gemini('x')), 'gemini: 이미지가 없으면 실패');
reply = () => new Response('quota', { status: 429 });
check(await fails(GENERATORS.gemini('x')), 'gemini: 429 면 실패');
delete process.env.GEMINI_API_KEY;
check(await fails(GENERATORS.gemini('x')), 'gemini: 키가 없으면 실패');

reply = () => new Response(Buffer.alloc(500, 1), { status: 200, headers: { 'content-type': 'image/jpeg' } });
check(await fails(GENERATORS.pollinations('x')), 'pollinations: 키가 없으면 부르지 않고 실패');
process.env.POLLINATIONS_API_KEY = 'pk';
img = await GENERATORS.pollinations('eye, uncanny');
check(img.ext === 'jpg' && lastUrl.startsWith('https://gen.pollinations.ai/image/eye%2C%20uncanny'), 'pollinations: jpeg 를 받는다');
check(lastOpts.headers.Authorization === 'Bearer pk' && !lastUrl.includes('pk'), 'pollinations: 키는 헤더로만');

reply = () => new Response('<html>rate limited</html>', { status: 200, headers: { 'content-type': 'text/html' } });
check(await fails(GENERATORS.pollinations('x')), 'pollinations: 200 이어도 이미지가 아니면 실패');

check(await fails(Promise.resolve().then(() => toImage(Buffer.alloc(10), 'image/png'))), '너무 작은 이미지는 거부');
check(await fails(Promise.resolve().then(() => toImage(Buffer.alloc(6e6), 'image/png'))), '5MB 넘는 이미지는 거부');
globalThis.fetch = realFetch;

// ── 라이브러리 태깅 ──────────────────────────────────────
check(JSON.stringify(tagsFromFilename('slime_green-02.png')) === '["slime","green"]', '파일명에서 태그 초안');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
