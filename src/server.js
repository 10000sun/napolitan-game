import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { q, loadAppliedRules } from './db.js';
import { currentUser, requireUser, setSession, authUrl, exchangeCode } from './auth.js';
import { buildWorld } from './world.js';
import { compileEntry, offlineFallback } from './compiler.js';
import { foldEffects } from './effects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── 인증 ────────────────────────────────────────────────────
app.get('/auth/login', (_req, res) => res.redirect(authUrl()));

app.get('/auth/callback', async (req, res) => {
  try {
    const user = await exchangeCode(req.query.code);
    if (!user) return res.status(403).send('이 문은 그 서버의 사람에게만 열립니다.');
    setSession(res, user);
    res.redirect('/');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post('/auth/logout', (_req, res) => { res.clearCookie('nps'); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({
    user: u ? { id: u.id, username: u.username, avatar: u.avatar, discord_id: u.discord_id } : null,
    devMode: process.env.DEV_NO_AUTH === '1',
  });
});

// ── 방명록 ──────────────────────────────────────────────────
app.get('/api/guestbook', (req, res) => {
  const u = currentUser(req);
  const rules = loadAppliedRules();
  const state = foldEffects(rules.map((r) => r.effects));
  res.json({
    entries: q.allEntries.all(),
    stats: q.stats.get(),
    // 방 내부 사정은 스포일러라 규모만 흘린다.
    room: { ruleCount: rules.length, size: state.mazeSize },
    pendingWrite: u ? (q.pendingWrite.get(u.id)?.id ?? null) : null,
  });
});

/**
 * 방명록 기입. 클리어한 런 하나당 한 번.
 * ("입구 쪽에서 쓴 내용은 반영 안 되는 것 같습니다.")
 */
app.post('/api/guestbook', requireUser, async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '아무것도 적지 않았습니다.' });
  if (text.length > 500) return res.status(400).json({ error: '공책의 한 칸에 그만큼은 들어가지 않습니다.' });

  const run = q.pendingWrite.get(req.user.id);
  if (!run) return res.status(403).json({ error: '출구 쪽 공책은 이곳을 빠져나온 사람에게만 열립니다.' });

  const rules = loadAppliedRules();
  const state = foldEffects(rules.map((r) => r.effects));

  let verdict;
  try {
    verdict = process.env.ANTHROPIC_API_KEY
      ? await compileEntry(text, rules, state)
      : offlineFallback();
  } catch (e) {
    console.error('[compile]', e.message);
    // 판정에 실패해도 글은 남는다. 방명록은 append-only 다.
    verdict = offlineFallback();
  }

  const entry = q.insertEntry.get(
    req.user.id, run.id, text, verdict.verdict, verdict.reason,
    JSON.stringify(verdict.effects), Date.now(),
  );
  q.useRunEntry.run(run.id);

  res.json({
    entry: { ...entry, username: req.user.username },
    verdict: verdict.verdict,
    reason: verdict.reason,
    changed: verdict.effects.length > 0,
  });
});

// ── 런 ──────────────────────────────────────────────────────
app.post('/api/run/start', requireUser, (req, res) => {
  const rules = loadAppliedRules();
  const world = buildWorld(rules);
  const run = q.insertRun.get(req.user.id, world.seed, rules.length, Date.now());

  // 출구가 요구하는 신체 부위는 미리 알려주지 않는다 (규칙이 허락하지 않는 한).
  const payload = { ...world };
  if (!world.state.exitCostKnown) payload.demandedPart = null;

  res.json({ runId: run.id, world: payload });
});

app.post('/api/run/:id/clear', requireUser, (req, res) => {
  const run = q.runById.get(Number(req.params.id));
  if (!run || run.user_id !== req.user.id) return res.status(404).json({ error: '그런 기록이 없습니다.' });
  if (run.cleared_at || run.died_at) return res.status(409).json({ error: '이미 끝난 기록입니다.' });

  // 가벼운 상식 검사. 100명짜리 친목 서버라 엄밀한 안티치트는 두지 않았다.
  const elapsed = Date.now() - run.started_at;
  if (elapsed < 2000) return res.status(400).json({ error: '그렇게 빨리 나갈 수는 없습니다.' });

  q.clearRun.run(Date.now(), run.id);
  res.json({ ok: true, canWrite: true, elapsedMs: elapsed });
});

app.post('/api/run/:id/die', requireUser, (req, res) => {
  const run = q.runById.get(Number(req.params.id));
  if (!run || run.user_id !== req.user.id) return res.status(404).json({ error: '그런 기록이 없습니다.' });
  q.dieRun.run(Date.now(), run.id);
  res.json({ ok: true });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n  나폴리탄  →  http://localhost:${port}`);
  if (process.env.DEV_NO_AUTH === '1') console.log('  ⚠ DEV_NO_AUTH=1 — 디스코드 로그인 없이 누구나 입장합니다.');
  if (!process.env.ANTHROPIC_API_KEY) console.log('  ⚠ ANTHROPIC_API_KEY 없음 — 방명록이 세계를 바꾸지 않습니다.');
  console.log('');
});
