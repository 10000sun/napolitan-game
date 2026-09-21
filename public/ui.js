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
  const { user } = await api('/api/me');
  me = user;

  // 이 방은 자기에 대해 아무것도 알려주지 않는다.
  // 들어오지 못한 사람에게만 들어올 방법을 알려준다.
  $('auth-box').innerHTML = me ? '' : '<a href="/auth/login">디스코드로 로그인</a>';
  $('btn-enter').disabled = !me;
}

/* ── 방명록 ───────────────────────────────────────── */
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

  // 기입권은 서버가 판단한다 — 클리어했고 아직 안 쓴 런이 있을 때만.
  const canWrite = book.pendingWrite !== null && book.pendingWrite !== undefined;
  $('write-box').classList.toggle('hidden', !canWrite);
  $('write-result').classList.add('hidden');
  $('write-text').value = '';
  $('write-count').textContent = '0 / 500';
  $('btn-submit').disabled = false;
  $('btn-submit').textContent = '적는다';

  show('guestbook');
  list.scrollTop = list.scrollHeight;
}

function entryHtml(e) {
  // 누가 언제 썼는지도, 이 방이 그 글을 받아들였는지도 알려주지 않는다.
  // 앞사람의 글이 먹혔는지 아닌지는 들어가 봐야 안다.
  return `<div class="entry"><div class="entry-text">${escapeHtml(e.raw_text)}</div></div>`;
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
    await api('/api/guestbook', { method: 'POST', body: JSON.stringify({ text }) });

    // 이 방이 글을 받아들였는지는 끝까지 알려주지 않는다.
    // 무엇이 달라졌는지는 다음 사람이 들어가 봐야 안다.
    const box = $('write-result');
    box.textContent = '당신은 공책을 덮었다.';
    box.classList.remove('hidden');
    $('write-text').value = '';
    $('write-count').textContent = '0 / 500';
    btn.textContent = '적었다';

    setTimeout(async () => {
      const book = await api('/api/guestbook');
      $('entries').innerHTML = book.entries.map(entryHtml).join('');
      $('entries').scrollTop = $('entries').scrollHeight;
      $('write-box').classList.add('hidden');
    }, 2000);
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
    $('choices').innerHTML = '';
    $('ending').classList.add('hidden');

    game = new Game(world, $('view'), $('minimap'), {
      onLog: pushLog,
      onHud: renderHud,
      onChoices: renderChoices,
      onHit: flashRed,
      onEnd: endRun,
    });
    game.start();
  } catch (e) {
    toast(e.message);
  }
}

function pushLog(text, cls = '') {
  if (!text) return;
  const log = $('log');
  // 지난 줄은 흐려진다. 방금 벌어진 일만 또렷하게.
  log.querySelectorAll('.log-line').forEach((l) => l.classList.add('old'));
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  line.textContent = text;
  log.appendChild(line);
  while (log.children.length > 7) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function renderChoices(list) {
  const box = $('choices');
  box.innerHTML = '';
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = `choice ${c.kind || ''}`;
    b.disabled = !!c.disabled;
    b.innerHTML = `<span class="key">${i + 1}</span><span>${escapeHtml(c.label)}</span>` +
                  (c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : '');
    b.onclick = () => game?.choose(c.id);
    box.appendChild(b);
  });
}

function renderHud(h) {
  $('hud-hp').innerHTML = h.noPain
    ? '몸 <b>멀쩡하다</b>'
    : `몸 <b class="${h.hp <= 35 ? 'low' : ''}">${h.hp}</b>`;

  const gear = [];
  if (h.hasPistol) gear.push(`권총 <b>${h.ammo}</b>발`);
  if (h.hasKnife) gear.push('칼');
  if (h.corpse > 0) gear.push(`시체 <b>${h.corpse}</b>구`);
  $('hud-gear').innerHTML = gear.join(' · ');

  $('hud-turns').innerHTML = h.turnsLeft > 0 ? `배고픔 <b class="low">${h.turnsLeft}</b>` : '';
}

function flashRed() {
  const g = $('game');
  g.style.boxShadow = 'inset 0 0 180px rgba(160,20,20,.8)';
  setTimeout(() => { g.style.boxShadow = ''; }, 200);
}

async function endRun(result) {
  $('choices').innerHTML = '';
  const title = $('ending-title');
  const text = $('ending-text');
  const btn = $('btn-ending');

  if (result.won) {
    try {
      await api(`/api/run/${runId}/clear`, { method: 'POST' });
    } catch (e) {
      // 여기서 조용히 넘어가면 기입 권한이 없는 이유를 아무도 알 수 없다.
      toast(e.message);
    }
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
  $('ending').classList.remove('hidden');
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
$('btn-quit').onclick = () => game?.die('스스로 걸음을 멈췄다.');
$('write-text').oninput = (e) => { $('write-count').textContent = `${e.target.value.length} / 500`; };

loadLobby().catch((e) => toast(e.message));
