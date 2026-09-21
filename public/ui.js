import { Game } from '/game.js';

const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '알 수 없는 오류');
  return data;
};

let me = null;
let game = null;
let runId = null;

/* ── 화면 전환 ────────────────────────────────────── */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ── 현관 ─────────────────────────────────────────── */
async function loadLobby() {
  const { user, devMode } = await api('/api/me');
  me = user;

  const box = $('auth-box');
  if (me) {
    box.innerHTML = `<span>${escapeHtml(me.username)} 님으로 들어와 있습니다.</span>`;
  } else {
    box.innerHTML = devMode
      ? '<span>개발 모드입니다.</span>'
      : '<a href="/auth/login">디스코드로 로그인</a> 해야 문이 열립니다.';
  }
  $('btn-enter').disabled = !me;

  const book = await api('/api/guestbook');
  renderRoomStatus(book);
}

function renderRoomStatus(book) {
  const { stats, room } = book;
  const rate = stats.attempts ? Math.round((stats.clears / stats.attempts) * 100) : 0;
  $('room-status').innerHTML = `
    공책에 적힌 글 <b>${stats.entries}</b>개 · 그중 이 방이 받아들인 것 <b>${stats.applied}</b>개<br>
    들어간 사람 <b>${stats.attempts}</b>명 · 나온 사람 <b>${stats.clears}</b>명 · 나오지 못한 사람 <b>${stats.deaths}</b>명<br>
    생환율 <b>${rate}%</b>`;
}

/* ── 방명록 ───────────────────────────────────────── */
const VERDICT_LABEL = {
  applied: '반영됨',
  duplicate: '겹침',
  contradiction: '밀려남',
  swallowed: '삼켜짐',
  flavor_only: '적히기만 함',
};

async function openBook() {
  const book = await api('/api/guestbook');
  const list = $('entries');

  if (!book.entries.length) {
    list.innerHTML = `<div class="empty-book">
      공책은 아직 비어 있다.<br>당신이 첫 번째다.
    </div>`;
  } else {
    list.innerHTML = book.entries.map(entryHtml).join('');
  }

  const s = book.stats;
  $('book-stats').innerHTML = `
    <span>총 ${s.entries}줄</span>
    <span>반영 ${s.applied}줄</span>
    <span>입장 ${s.attempts}회</span>
    <span>생환 ${s.clears}회</span>`;

  // 기입권은 서버가 판단한다 — 클리어했고 아직 안 쓴 런이 있을 때만.
  const canWrite = book.pendingWrite !== null && book.pendingWrite !== undefined;
  $('write-box').classList.toggle('hidden', !canWrite);
  $('write-result').classList.add('hidden');
  $('write-text').value = '';
  $('write-count').textContent = '0 / 500';
  $('btn-submit').disabled = false;

  show('guestbook');
  list.scrollTop = list.scrollHeight;
}

function entryHtml(e) {
  const when = new Date(e.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  const tag = VERDICT_LABEL[e.verdict] || '';
  return `<div class="entry ${e.verdict}">
    <div class="entry-meta">
      <span>${escapeHtml(e.username)}</span>
      <span>${when}</span>
      <span class="tag ${e.verdict}">${tag}</span>
    </div>
    <div class="entry-text">${escapeHtml(e.raw_text)}</div>
    ${e.reason ? `<div class="entry-reason">${escapeHtml(e.reason)}</div>` : ''}
  </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function submitEntry() {
  const text = $('write-text').value.trim();
  if (!text) return;
  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = '공책이 글을 읽고 있다...';

  try {
    const res = await api('/api/guestbook', { method: 'POST', body: JSON.stringify({ text }) });
    const box = $('write-result');
    box.textContent = res.reason;
    box.classList.remove('hidden');
    $('write-text').value = '';
    $('btn-submit').textContent = '적었다';

    setTimeout(async () => {
      const book = await api('/api/guestbook');
      $('entries').innerHTML = book.entries.map(entryHtml).join('');
      $('entries').scrollTop = $('entries').scrollHeight;
      $('write-box').classList.add('hidden');
      renderRoomStatus(book);
    }, 2200);
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = '적는다';
  }
}

/* ── 게임 ─────────────────────────────────────────── */
async function enterRoom() {
  try {
    const { runId: id, world } = await api('/api/run/start', { method: 'POST' });
    runId = id;
    show('game');

    $('log').innerHTML = '';
    $('pause').classList.add('hidden');
    $('ending').classList.add('hidden');
    $('prompt').classList.add('hidden');

    game = new Game(world, $('view'), $('minimap'), {
      onLog: pushLog,
      onHud: renderHud,
      onPause: (p) => $('pause').classList.toggle('hidden', !p),
      onPrompt: (text) => {
        const el = $('prompt');
        if (text) { el.textContent = text; el.classList.remove('hidden'); }
        else el.classList.add('hidden');
      },
      onHit: flashRed,
      onEnd: endRun,
    });
    game.start();
    $('view').requestPointerLock();
  } catch (e) {
    toast(e.message);
  }
}

function pushLog(text, cls = '') {
  const log = $('log');
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  line.textContent = text;
  log.appendChild(line);
  while (log.children.length > 6) log.removeChild(log.firstChild);
  setTimeout(() => line.remove(), 9000);
}

function renderHud(h) {
  $('hp-bar').style.width = `${(h.hp / h.maxHp) * 100}%`;
  $('hp-text').textContent = h.noPain ? '∞' : h.hp;

  const names = { fist: '맨손', knife: '칼', pistol: '권총' };
  const parts = [`<span class="hud-label">무기</span><span>${names[h.weapon]}</span>`];
  if (h.weapon === 'pistol') parts.push(`<span>${h.ammo}발</span>`);
  if (h.corpse > 0) parts.push(`<span class="hud-label">시체</span><span>${h.corpse}구</span>`);
  $('hud-weapon').innerHTML = parts.join(' ');

  const timer = $('hud-timer');
  if (h.hunger > 0) {
    timer.classList.remove('hidden');
    const m = Math.floor(h.hunger / 60), s = Math.floor(h.hunger % 60);
    timer.innerHTML = `<span class="hud-label">배고픔</span><span>${m}:${String(s).padStart(2, '0')}</span>`;
  } else timer.classList.add('hidden');
}

function flashRed() {
  const g = $('game');
  g.style.boxShadow = 'inset 0 0 160px rgba(160,20,20,.75)';
  setTimeout(() => { g.style.boxShadow = ''; }, 160);
}

async function endRun(result) {
  const card = $('ending');
  const title = $('ending-title');
  const text = $('ending-text');
  const btn = $('btn-ending');

  if (result.won) {
    try { await api(`/api/run/${runId}/clear`, { method: 'POST' }); } catch (e) { console.warn(e); }
    title.textContent = '문 밖으로 나왔다';
    let body = '등 뒤에서 문이 닫힌다.';
    if (result.lostParts.length) {
      body += result.healed
        ? ` 이곳에서 잃은 ${result.lostParts.length}가지가 전부 제자리로 돌아왔다.`
        : ` ${result.lostParts.join(', ')}은(는) 저 안에 두고 왔다.`;
    }
    body += ' 출구 쪽에도 똑같은 공책이 놓여 있다.';
    text.textContent = body;
    btn.textContent = '공책에 한 줄 남긴다';
    btn.onclick = openBook;
  } else {
    try { await api(`/api/run/${runId}/die`, { method: 'POST' }); } catch (e) { console.warn(e); }
    title.textContent = '나오지 못했다';
    text.textContent = `${result.reason || '죽었다.'} 당신의 몸도 이제 저 안에 쌓인 것들 중 하나가 된다.`;
    btn.textContent = '현관으로';
    btn.onclick = backToLobby;
  }
  card.classList.remove('hidden');
}

function backToLobby() {
  game?.stop();
  game = null;
  runId = null;
  show('lobby');
  loadLobby();
}

/* ── 연결 ─────────────────────────────────────────── */
$('btn-read').onclick = openBook;
$('btn-enter').onclick = enterRoom;
$('btn-close-book').onclick = backToLobby;
$('btn-submit').onclick = submitEntry;
$('btn-resume').onclick = () => game?.setPaused(false);
$('btn-give-up').onclick = () => { game?.die('스스로 걸음을 멈췄다.'); };
$('write-text').oninput = (e) => { $('write-count').textContent = `${e.target.value.length} / 500`; };

loadLobby().catch((e) => toast(e.message));
