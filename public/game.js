// ─────────────────────────────────────────────────────────────
// 턴제 텍스트 어드벤처 엔진 + 1인칭 배경 렌더
//
// 화면은 지금 서 있는 자리에서 보이는 것을 그린다. 조작은 하지 않는다.
// 플레이어는 선택지를 고르고, 고를 때마다 한 턴이 지나간다.
// 돌아서는 것은 턴을 쓰지 않는다 — 주위를 둘러보는 데 대가를 물리면
// 아무도 둘러보지 않는다.
// ─────────────────────────────────────────────────────────────

import { sprite, drawUncanny, stretchFor, emojiCanvas, decalPixels, filteredCanvas } from '/uncanny.js';
import { TEX, buildSurfaces, lightTile } from '/textures.js';
import { faceOf, raySegment, wallU, fogOf } from '/geometry.js';
import { RuleEngine } from '/rules.js';
import { nextStep, wanderStep } from '/paths.js';
import { pickPart, effectsOf, severityOf } from '/body.js';
import { COMBAT, EVENTS, resolve, available, pickSpecial, rollAttack, dodgeChance, monsterSteps, turnCost } from '/encounters.js';

const TAU = Math.PI * 2;

const FOG = [58, 52, 34];                  // 누런 안개
const SCALES = [1, 0.75, 0.55];            // 느리면 한 단계씩 내린다
const ITEM_EMOJI = { pistol: '🔫', knife: '🔪', map: '🗺️' };

const COLORS = {
  wallLight: [88, 86, 79],
  wallDark: [52, 51, 47],
  ceil: [15, 15, 14],
  floor: [38, 37, 33],
  monster: [122, 30, 26],
  corpse: [56, 51, 43],
  pistol: [150, 145, 130],
  knife: [170, 170, 175],
  exit: [190, 160, 70],
  trap: [90, 40, 40],
};

const ITEM_NAME = { pistol: '권총', knife: '칼', map: '지도' };

// 0=동 1=남 2=서 3=북
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DIR_NAME = ['동', '남', '서', '북'];

/* ── 소리 ─────────────────────────────────────────── */
class Audio2 {
  constructor() { this.ctx = null; }
  resume() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* 소리 없어도 플레이 가능 */ } }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
  blip(freq, dur, type = 'square', gain = 0.08) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur);
  }
  noise(dur = 0.12, gain = 0.15) {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.buffer = buf; s.connect(g).connect(this.ctx.destination); s.start();
  }
  shot() { this.noise(0.16, 0.22); this.blip(90, 0.12, 'square', 0.12); }
  hurt() { this.blip(70, 0.25, 'sawtooth', 0.14); }
  pickup() { this.blip(660, 0.09, 'sine', 0.09); setTimeout(() => this.blip(880, 0.09, 'sine', 0.08), 70); }
  door() { this.blip(180, 0.5, 'sine', 0.12); }
  growl() { this.blip(55 + Math.random() * 20, 0.35, 'sawtooth', 0.06); }
  step() { this.blip(120, 0.06, 'sine', 0.04); }
}

/* ── 게임 ─────────────────────────────────────────── */
export class Game {
  constructor(world, canvas, minimap, hooks = {}, body = { lostParts: [] }) {
    this.w = world;
    this.s = world.state;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.mm = minimap;
    this.mmCtx = minimap.getContext('2d');
    this.hooks = hooks;
    this.audio = new Audio2();

    this.grid = world.grid.map((r) => r.slice());
    this.size = world.size;

    // 칸 단위 위치 + 바라보는 방향
    this.cx = Math.floor(world.spawn.x);
    this.cy = Math.floor(world.spawn.y);
    this.facing = 0;

    // 카메라는 이 값을 향해 부드럽게 따라간다
    this.px = this.cx + 0.5;
    this.py = this.cy + 0.5;
    this.angle = 0;
    this.fov = 1.0;   // 화면 평면의 길이. 약 66도.

    this.hp = 100;
    this.maxHp = 100;
    this.dead = false;
    this.won = false;
    this.busy = false;
    this.turn = 0;

    this.hasPistol = false;
    this.hasKnife = false;
    this.rangedName = null;       // 원거리 무기 이름 (권총, 활 ...)
    this.meleeName = null;        // 근접 무기 이름 (칼, 쇠파이프 ...)
    this.ammo = 0;
    this.carriedCorpse = 0;

    this.mapKnown = !!this.s.map;
    // 이미 잃고 들어온 부위. 체력은 다시 깎지 않는다.
    this.lostBefore = [...(body.lostParts || [])];
    this.lostParts = [];            // 이번 판에 잃은 것
    if (effectsOf(this.lostBefore).has('deaf')) this.audio.muted = true;

    this.monsters = world.monsters.map((m) => ({
      id: m.id, x: Math.floor(m.x), y: Math.floor(m.y), alive: true, stun: 0,
    }));
    this.corpses = world.corpses.map((c, i) => ({ id: `c${i}`, x: c.x, y: c.y, taken: false }));
    this.traps = world.traps.map((t, i) => ({ id: `t${i}`, x: t.x, y: t.y, sprung: false }));
    this.items = world.items.filter((it) => !it.auto)
      .map((it) => ({ ...it, x: Math.floor(it.x), y: Math.floor(it.y), taken: false }));
    this.baits = [];
    this.unlocked = false;          // 출구 번호를 이미 맞췄는가
    this.pendingTurns = 0;
    this.event = null;              // 진행 중인 후속 이벤트 { id, monster }
    this.specials = new Map();      // 조우 대상 id → 뽑힌 특수 행동 (한 번만 뽑는다)
    this.noticed = new Map();       // 함정 id → 알아챘는지 (한 번만 굴린다)
    this.rangedIsPistol = false;

    // 방명록 물체. 규칙에는 영향 없이 서 있기만 한다.
    this.objects = (world.objects || []).map((o) => ({
      ...o, dx: 0, dy: 0, stretch: stretchFor(o.id), wasVisible: false, visible: false, taken: false,
    }));
    for (const o of this.objects) sprite(o.img);
    for (const it of this.items) sprite(it.img);
    if (this.w.monsterLook) sprite(this.w.monsterLook.img);

    this.seen = Array.from({ length: this.size }, () => Array(this.size).fill(this.mapKnown));

    this.zBuf = [];
    this.raf = 0;
    this.lastT = 0;
    this.sway = 1;                  // 공기 중 먼지를 비추는 빛의 흔들림
    this.t = 0;
    // 공기 중에 떠 있는 것들. 화면이 완전히 정지해 보이지 않게 한다.
    this.dust = Array.from({ length: 46 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.4 + Math.random() * 1.1,
      vx: (Math.random() - 0.5) * 0.012,
      vy: 0.004 + Math.random() * 0.014,
      a: 0.06 + Math.random() * 0.16,
    }));

    this._onResize = () => this._resize();
    this._onKey = (e) => this._hotkey(e);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey);

    this.rules = new RuleEngine(world.rules || []);
    // 규칙이 이름을 부른 물체는 만질 수 있는 것이다. 이런 건 바닥에 눕혀
    // 칠하지 않고 세워서 시점을 따라가게 한다 — 납작하면 무엇인지 못 알아본다.
    this.hot = new Set((world.rules || []).map((r) => r.target).filter(Boolean));
    this.darkTurns = 0;             // 규칙이 불을 끈 남은 턴
    this.freshTurn = -1;
    this.revealTurns = 0;           // 규칙이 지도를 보여 주는 남은 턴
    // 깜놀. 자주 터지면 개그가 되므로 엔진이 직접 횟수와 간격을 쥔다.
    this.scares = 0;
    this.lastScare = -99;
    this.phantom = null;            // 등 뒤에 선 것. 판 위의 괴물이 아니라 유령이다
    this.lieUntil = -1;             // 이 턴까지 버튼이 거짓말한다
    this.frozen = false;            // 암전 중에는 아무것도 고를 수 없다
    this.calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.tex = null;                        // 텍스처가 오기 전에는 예전 단색으로 그린다
    buildSurfaces(world.surfaces).then((t) => { this.tex = t; }).catch(() => {});
    this.scaleIdx = 0;
    this.frameMs = [];
    this.flickerUntil = 0;
    this.decalFrame = 0;
    this.floorDecal = new Int16Array(this.size * this.size).fill(-1);
    this.floorDecals = [];
    this.wallDecals = new Map();

    this._resize();
    // 지도가 없으면 미니맵도 없다.
    this.mm.style.display = this.s.map ? '' : 'none';
    this.reveal();
    this._intro();
  }

  /* ── 수명주기 ─────────────────────────────────── */
  start() {
    this.audio.resume();
    this.lastT = performance.now();
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.stepCamera(dt);
      // 느리면 해상도를 한 단계 내린다. 올리지는 않는다.
      // 텍스처를 만드는 동안의 끊김은 느린 기기로 오판하지 않도록 텍스처가 온 뒤부터 잰다.
      if (this.tex) this.frameMs.push(dt * 1000);
      if (this.frameMs.length >= 30) {
        const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
        this.frameMs = [];
        if (avg > 28 && this.scaleIdx < SCALES.length - 1) { this.scaleIdx++; this._resize(); }
      }
      this.render();
      if (this.mapKnown || this.revealTurns > 0) this.drawMinimap();
    };
    this.raf = requestAnimationFrame(loop);
    this.pushState();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
  }

  log(text, cls = '') {
    if (!text) return;
    // 같은 말을 연달아 두 번 하지 않는다
    if (text === this._lastLog) return;
    this._lastLog = text;
    this.hooks.onLog?.(text, cls);
  }

  _resize() {
    const cw = this.canvas.clientWidth || 400, ch = this.canvas.clientHeight || 260;
    // 고해상도 화면은 선명하게, 단 픽셀 수는 약 110만 개로 묶는다 (폰이 버티게). 느리면 SCALES 로 더 내린다.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const budget = Math.sqrt(1.1e6 / (cw * ch));
    const scale = Math.min(dpr, budget) * SCALES[this.scaleIdx || 0];
    this.rw = Math.max(200, Math.floor(cw * scale));
    this.rh = Math.max(120, Math.floor(ch * scale));
    // 세로로 좁은 화면에서는 시야를 좁혀 벽과 물체가 가늘게 늘어나지 않게 한다. 가로 화면은 그대로.
    this.fov = Math.max(0.55, Math.min(1, (cw / ch) / 1.6));
    this.canvas.width = this.rw;
    this.canvas.height = this.rh;
    this.img = this.ctx.createImageData(this.rw, this.rh);
    const mmSize = Math.min(150, Math.max(96, Math.floor(window.innerWidth * 0.11)));
    this.mm.width = this.mm.height = mmSize;
  }

  _hotkey(e) {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) {
      const c = this.choices?.[n - 1];
      if (c) { e.preventDefault(); this.choose(c.id); }
    }
  }

  _intro() {
    // 방은 자기를 설명하지 않는다. 앞사람이 남긴 것들만 먼저 눈에 들어온다.
    for (const f of (this.s.flavor || []).slice(-3)) this.log(f, 'sys');
    // 몸으로 알 수 없는 것만 알려준다. 나머지는 겪어서 알아낸다.
    if (this.mapKnown) this.log('손에 지도가 들려 있다.');
    if (this.lostBefore.length) this.log(`${this.lostBefore.join(', ')} 없이 들어왔다.`, 'sys');
    this.describe();
    this.runRules();
  }

  /* ── 카메라 ───────────────────────────────────── */
  stepCamera(dt) {
    this.t += dt;
    // 어딘가의 불빛이 일정하지 않다
    this.sway = 0.93 + 0.07 * Math.sin(this.t * 2.3)
      + 0.035 * Math.sin(this.t * 11.7) + 0.02 * Math.sin(this.t * 29.1);
    for (const p of this.dust) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); }
      if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
    }

    this.checkPhantom();

    const tx = this.cx + 0.5, ty = this.cy + 0.5;
    const ta = this.facing * (Math.PI / 2);
    const k = Math.min(1, dt * 9);
    this.px += (tx - this.px) * k;
    this.py += (ty - this.py) * k;
    let d = ta - this.angle;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.angle += d * k;
  }

  /* ── 상태 ─────────────────────────────────────── */
  hudState() {
    return {
      hp: Math.max(0, Math.round(this.hp)),
      maxHp: this.maxHp,
      ammo: this.ammo,
      hasPistol: this.hasPistol,
      hasKnife: this.hasKnife,
      corpse: this.carriedCorpse,
      lost: this.allLost,
      rangedName: this.rangedName,
      noPain: this.s.noPain,
      facing: DIR_NAME[this.facing],
    };
  }

  pushState() {
    this.hooks.onHud?.(this.hudState());
    this.choices = this.buildChoices();
    this.hooks.onChoices?.(this.choices);
  }

  get allLost() { return [...this.lostBefore, ...this.lostParts]; }
  get fx() { return effectsOf(this.allLost); }

  ahead(n = 1) {
    const [dx, dy] = DIRS[this.facing];
    return { x: this.cx + dx * n, y: this.cy + dy * n };
  }

  wall(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return true;
    return this.grid[y][x] === 1;
  }

  monsterAt(x, y) { return this.monsters.find((m) => m.alive && m.x === x && m.y === y); }

  /** 바라보는 방향으로 벽에 막힐 때까지 훑어 첫 괴물을 찾는다. */
  monsterInSight(maxDist = 8) {
    const [dx, dy] = DIRS[this.facing];
    for (let i = 1; i <= maxDist; i++) {
      const x = this.cx + dx * i, y = this.cy + dy * i;
      if (this.wall(x, y)) return null;
      const m = this.monsterAt(x, y);
      if (m) return { m, dist: i };
    }
    return null;
  }

  atExit() { return !!this.w.exit && this.cx === this.w.exit.x && this.cy === this.w.exit.y; }

  itemHere() { return this.items.find((it) => !it.taken && it.x === this.cx && it.y === this.cy); }
  corpseHere() { return this.corpses.find((c) => !c.taken && c.x === this.cx && c.y === this.cy); }
  toolHere() {
    return this.objects.find((o) => !o.taken && o.use !== 'none' && o.x === this.cx && o.y === this.cy);
  }

  /* ── 선택지 ───────────────────────────────────── */
  buildChoices() {
    if (this.dead || this.won || this.frozen) return [];
    const out = [];
    if (this.event) {
      const ev = EVENTS[this.event.id];
      const ctx = this.encounterCtx();
      ev.choices.forEach((c, i) => {
        const ok = (c.needs || []).every((n) => (n.startsWith('!') ? !ctx.effects.has(n.slice(1)) : !!ctx[n]));
        if (ok) out.push({ id: `ev:${i}`, label: c.label, kind: 'fight' });
      });
      return out;
    }
    const a = this.ahead();
    const blocked = this.wall(a.x, a.y);
    const sight = this.monsterInSight();

    if (this.atExit()) {
      // 번호가 걸려 있으면 그게 먼저다. 풀고 나서야 문을 열 수 있다.
      if (this.w.lock && !this.unlocked) {
        out.push({ id: 'keypad', label: '번호를 누른다', hint: `${this.w.lock.digits}자리`, kind: 'exit' });
      } else {
        out.push(this.s.exitCost === 'random_body_part'
          ? { id: 'exit', label: '무언가를 두고 나간다', kind: 'exit' }
          : { id: 'exit', label: '문을 연다', kind: 'exit' });
      }
    }

    const it = this.itemHere();
    // 팔이 없으면 주울 수 없다.
    const noGrab = this.fx.has('noGrab');
    const grab = noGrab ? { disabled: true, hint: '팔이 없다' } : {};
    if (it) out.push({ id: 'take', label: `${ITEM_NAME[it.kind] || '무언가'}을(를) 줍는다`, kind: 'act', ...grab });
    const tool = this.toolHere();
    if (tool) out.push({ id: 'tool', label: `${tool.name}을(를) 줍는다`, kind: 'act', ...grab });
    const co = this.corpseHere();
    if (co) out.push({ id: 'corpse', label: '시체를 챙긴다', kind: 'act', ...grab });

    if (sight && (!this.fx.has('blind') || sight.dist === 1)) {
      if (this.hasPistol && this.ammo > 0) {
        const noTrigger = this.fx.has('noTrigger');
        out.push({ id: 'shoot', label: `${this.rangedName || '총'}을(를) 쏜다`, hint: noTrigger ? '방아쇠를 당길 손가락이 없다' : `${this.ammo}번 남음`, disabled: noTrigger, kind: 'fight' });
      }
      if (sight.dist === 1) {
        const label = this.meleeName && this.meleeName !== '칼' ? `${this.meleeName}(으)로 내려친다`
          : this.hasKnife ? '칼로 벤다' : '맨손으로 친다';
        out.push({ id: 'melee', label, kind: 'fight' });
        out.push({ id: 'dodge', label: this.sideCell() ? '몸을 피한다' : '뒤로 물러선다', kind: 'move' });
        const sp = this.specialFor(sight.m.id, 'monster');
        if (sp && available([sp], this.encounterCtx()).length) out.push({ id: `sp:${sight.m.id}`, label: sp.label, kind: 'move' });
      }
    }
    const trap = !sight && this.trapAhead();
    if (trap) {
      out.push({ id: 'avoid', label: '조심스럽게 피해 지나간다', kind: 'move' });
      const sp = this.specialFor(trap.id, 'trap');
      if (sp && available([sp], this.encounterCtx()).length) out.push({ id: `sp:${trap.id}`, label: sp.label, kind: 'move' });
    }
    if (this.carriedCorpse > 0) {
      out.push({ id: 'bait', label: '시체를 던진다', hint: `${this.carriedCorpse}구`, kind: 'act' });
    }

    for (const { rule, i } of this.rules.buttons(this.reachKeys())) {
      const o = this.objects.find((x) => !x.taken && x.key === rule.target);
      out.push({ id: `rule:${i}`, label: `${o ? o.name : rule.target}을(를) ${rule.verb}`, kind: 'act' });
    }

    // 이동은 방향대로 놓는다. 화면 왼쪽 버튼이 왼쪽으로 도는 버튼이어야
    // 손이 헷갈리지 않는다. group: 'nav' 가 붙은 것은 따로 모아 판으로 깐다.
    //   앞으로 나아간다 | 뒤돌아선다
    //   왼쪽으로 돈다   | 오른쪽으로 돈다
    out.push(blocked
      ? { id: 'forward', label: '앞은 벽이다', kind: 'move', group: 'nav', disabled: true }
      : { id: 'forward', label: '앞으로 나아간다', kind: 'move', group: 'nav' });
    out.push({ id: 'back', label: '뒤돌아선다', kind: 'turn', group: 'nav' });
    out.push({ id: 'left', label: '왼쪽으로 돈다', kind: 'turn', group: 'nav' });
    out.push({ id: 'right', label: '오른쪽으로 돈다', kind: 'turn', group: 'nav' });
    // 한 턴 동안 버튼이 딴소리를 한다. 자리는 그대로라 길을 잃지는 않는다.
    if (this.turn <= this.lieUntil) {
      const lies = { forward: '뒤를 봐', back: '보지 마', left: '왼쪽에 있다', right: '오른쪽에 있다' };
      for (const o of out) if (lies[o.id] && !o.disabled) o.label = lies[o.id];
    }
    return out;
  }

  /* ── 진행 ─────────────────────────────────────── */
  choose(id) {
    if (this.busy || this.dead || this.won) return;
    const c = (this.choices || []).find((x) => x.id === id);
    if (!c || c.disabled) return;
    this.audio.resume();

    let spendsTurn = true;
    const before = { x: this.cx, y: this.cy };
    switch (id) {
      case 'left': this.facing = (this.facing + 3) % 4; spendsTurn = false; this.describe(); break;
      case 'right': this.facing = (this.facing + 1) % 4; spendsTurn = false; this.describe(); break;
      case 'back': this.facing = (this.facing + 2) % 4; spendsTurn = false; this.describe(); break;
      case 'forward': this.moveForward(); break;
      case 'take': this.takeItem(); break;
      case 'tool': this.takeTool(); break;
      case 'dodge': this.dodge(); break;
      case 'avoid': this.avoidTrap(); break;
      case 'corpse': this.takeCorpse(); break;
      case 'shoot': this.shoot(); break;
      case 'melee': this.melee(); break;
      case 'bait': this.throwBait(); break;
      case 'keypad':
        spendsTurn = false;          // 번호판을 여는 것만으로는 시간이 가지 않는다
        this.hooks.onKeypad?.({ digits: this.w.lock.digits });
        break;
      case 'exit': this.tryExit(); break;
      default:
        if (id.startsWith('ev:')) { this.eventChoice(Number(id.slice(3))); break; }
        if (id.startsWith('sp:')) { this.special(id.slice(3)); break; }
        if (id.startsWith('rule:')) {
          const i = Number(id.slice(5));
          const acts = this.rules.act(i);
          if (acts.length) this.doActions(acts, this.rules.rules[i]?.target, true);
          else this.log('아무 일도 일어나지 않았다.');
          break;
        }
        return;
    }

    if (this.won || this.dead) { this.pushState(); return; }
    if (spendsTurn) {
      // 다리가 없으면 칸을 옮기는 모든 행동이 세 턴이다.
      const turns = turnCost({ moved: this.cx !== before.x || this.cy !== before.y, slow: this.fx.has('slow'), pending: this.pendingTurns });
      this.pendingTurns = 0;
      for (let i = 0; i < turns && !this.dead; i++) this.endTurn();
      this.runRules();   // 돌아서기(턴 안 씀)로는 규칙을 되풀이할 수 없다
    }
    this.pushState();
  }

  moveForward() {
    const a = this.ahead();
    if (this.wall(a.x, a.y)) return;
    const m = this.monsterAt(a.x, a.y);
    if (m) { this.log('앞을 가로막은 것이 비키지 않는다.', 'bad'); return; }
    this.cx = a.x; this.cy = a.y;
    this.audio.step();
    this.reveal();
    this.checkTrap();
    if (!this.dead) this.describe();
  }

  takeItem() {
    const it = this.itemHere();
    if (!it) return;
    it.taken = true;
    this.audio.pickup();
    if (it.kind === 'pistol') {
      this.hasPistol = true;
      this.rangedName = '권총';
      this.rangedIsPistol = true;
      this.ammo += this.s.ammo || 12;
      this.log(`권총을 주웠다. 탄약 ${this.ammo}발.`);
    } else if (it.kind === 'knife') {
      this.hasKnife = true;
      this.meleeName = '칼';
      this.log('칼을 주웠다. 손에 익는다.');
    } else if (it.kind === 'map') {
      this.mapKnown = true;
      this.log('지도를 펼쳤다. 미로가 전부 드러났다.');
    }
    const got = this.rules.pickup({ pistol: '권총', knife: '칼', map: '지도' }[it.kind]);
    if (got.length) this.doActions(got, undefined, true);
    this.decalFrame = 0;
  }

  takeTool() {
    const o = this.toolHere();
    if (!o) return;
    o.taken = true;
    this.audio.pickup();
    if (o.use === 'ranged') {
      this.hasPistol = true;
      this.rangedName = o.name;
      this.rangedIsPistol = false;
      this.ammo += 12;
      this.log(`${o.name}을(를) 주웠다. 쏠 것이 ${this.ammo}번 남았다.`);
    } else {
      this.hasKnife = true;
      this.meleeName = o.name;
      this.log(`${o.name}을(를) 주웠다. 손에 쥐어 본다.`);
    }
    const got = this.rules.pickup(o.key);
    if (got.length) this.doActions(got, o.key, true);
    this.decalFrame = 0;
  }

  takeCorpse() {
    const c = this.corpseHere();
    if (!c) return;
    c.taken = true;
    this.carriedCorpse++;
    this.log(`비교적 멀쩡한 시체를 챙겼다. (${this.carriedCorpse}구)`);
  }

  shoot() {
    const sight = this.monsterInSight();
    if (this.ammo <= 0) { this.log('남은 것이 없다.', 'bad'); return; }
    this.ammo--;
    this.audio.shot();
    const name = this.rangedName || '총';
    if (!sight) { this.log(`${name}이(가) 허공을 가른다. 아무것도 맞지 않았다.`); return; }
    if (rollAttack(this.rangedIsPistol ? 'pistol' : 'weapon', false, this.fx)) this.killMonster(sight.m);
    else this.log('빗나갔다.', 'bad');     // 떨어져 있으니 반격은 없다
  }

  melee() {
    const sight = this.monsterInSight(1);
    this.audio.blip(200, 0.07, 'square', 0.06);
    if (!sight) { this.log('허공을 갈랐다.'); return; }
    if (rollAttack(this.hasKnife ? 'weapon' : 'bare', true, this.fx)) { this.killMonster(sight.m); return; }
    this.log('맞았지만 그것은 꿈쩍도 하지 않는다. 그것이 반격한다.', 'bad');
    this.damage(this.s.noPain ? 0 : COMBAT.counterDamage);
    if (!this.dead && Math.random() < COMBAT.counterPartChance) this.losePart('random', '그것이 물어뜯었다.');
    sight.m.stun = 1;   // 반격이 그 턴의 물기를 대신한다
  }

  killMonster(m) {
    m.alive = false;
    this.audio.blip(60, 0.4, 'sawtooth', 0.1);
    this.log('그것이 무너져 내렸다.');
    if (this.monsters.every((x) => !x.alive)) this.log('더 이상 아무 소리도 들리지 않는다.', 'sys');
  }

  /** 규칙이 볼 지금 상태. */
  /** 규칙이 볼 수 있는 것들과 그것에 다가갈 수 있는 칸. 벽 물체는 그 벽면 앞 칸. */
  ruleSpots() {
    const out = [];
    for (const o of this.objects) {
      if (o.taken) continue;
      if (o.where === 'wall') { const [dx, dy] = DIRS[o.face]; out.push({ key: o.key, x: o.x + dx, y: o.y + dy, o }); }
      else out.push({ key: o.key, x: o.x, y: o.y, o });
    }
    for (const it of this.items) if (!it.taken) out.push({ key: ITEM_NAME[it.kind], x: it.x, y: it.y });
    return out;
  }

  ruleState() {
    const spots = this.ruleSpots();
    const here = new Set(spots.filter((p) => p.x === this.cx && p.y === this.cy).map((p) => p.key));
    const near = new Set(spots.filter((p) => Math.abs(p.x - this.cx) + Math.abs(p.y - this.cy) <= 1).map((p) => p.key));
    return { turn: this.turn, here, near, seeMonster: !!this.monsterInSight(), hp: this.hp, atDoor: this.atExit() };
  }

  /** 발밑·바로 앞(벽 물체는 마주 본 벽면)에 있는 물체 key. 규칙 버튼의 대상. */
  reachKeys() {
    const a = this.ahead();
    const face = (this.facing + 2) % 4;
    const keys = new Set(this.objects.filter((o) => !o.taken && (
      (o.where !== 'wall' && ((o.x === this.cx && o.y === this.cy) || (o.x === a.x && o.y === a.y)))
      || (o.where === 'wall' && o.x === a.x && o.y === a.y && o.face === face))).map((o) => o.key));
    for (const it of this.items) {
      if (!it.taken && ((it.x === this.cx && it.y === this.cy) || (it.x === a.x && it.y === a.y))) keys.add(ITEM_NAME[it.kind]);
    }
    return keys;
  }

  runRules() {
    if (this.dead || this.won) return;
    const acts = this.rules.update(this.ruleState());
    if (acts.length) this.doActions(acts);
  }

  /** 규칙의 행동을 적용한다. target: 그 규칙의 대상 물체 key */
  doActions(acts, target, fresh = false) {
    if (fresh) this.freshTurn = this.turn;   // 이번 선택이 켠 암전·지도는 이어지는 endTurn 에서 줄지 않는다
    for (const a of acts) {
      if (this.dead || this.won) return;
      switch (a.act) {
        case 'say': this.log(a.text, 'sys'); break;
        case 'hp':
          if (a.amount > 0) {
            this.log(this.hp >= this.maxHp ? '몸은 이미 멀쩡하다.' : '몸이 조금 나아졌다.');
            this.hp = Math.min(this.maxHp, this.hp + a.amount);
          }
          else this.damage(this.s.noPain ? 0 : -a.amount, '어딘가가 욱신거린다.');
          break;
        case 'lose_part': this.losePart(a.effect); break;
        case 'teleport': this.teleport(a.to); break;
        case 'monster': this.ruleMonsters(a); break;
        case 'dark': this.darkTurns = Math.max(this.darkTurns, a.turns); this.log('불이 꺼졌다.', 'bad'); break;
        case 'give': this.ruleGive(a); break;
        case 'object': this.ruleObject(a.do, a.target ?? target); break;
        case 'sound':
          if (!this.fx.has('deaf')) {
            if (a.kind === 'scream') this.audio.blip(880, 0.5, 'sawtooth', 0.08);
            else if (a.kind === 'knock') { this.audio.blip(90, 0.08, 'square', 0.1); this.audio.blip(90, 0.08, 'square', 0.1); }
            else this.audio.noise(0.6, 0.05);
          }
          break;
        case 'scare': this.fireScare(); break;
        case 'random': this.doActions([this.rollRandom()], target); break;
        case 'reveal':
          this.revealTurns = Math.max(this.revealTurns, a.turns);
          this.mm.style.display = '';
          this.log('머릿속에 이곳의 모양이 떠오른다.');
          break;
      }
    }
    this.decalFrame = 0;
    // 주변이 바뀌었을 때만 다시 둘러본다 (문장만 나온 규칙에 서술이 겹치지 않게)
    if (!this.dead && acts.some((a) => ['teleport', 'object', 'monster'].includes(a.act))) this.describe();
  }

  /**
   * 무엇이 나올지 모르는 한 번. 이스터에그를 눌렀을 때 쓴다.
   * 출구로 보내는 순간이동은 넣지 않는다 — 누르기만 하면 이기는 건 게임이 아니다.
   */
  rollRandom() {
    const pool = [
      { act: 'scare' },
      { act: 'monster', do: 'spawn', count: 1 },
      { act: 'monster', do: 'flee' },
      { act: 'hp', amount: -20 },
      { act: 'hp', amount: 25 },
      { act: 'give', item: 'pistol' },
      { act: 'give', item: 'ammo', count: 8 },
      { act: 'give', item: 'knife' },
      { act: 'give', item: 'map' },
      { act: 'dark', turns: 2 },
      { act: 'reveal', turns: 4 },
      { act: 'teleport', to: 'random' },
      { act: 'sound', kind: 'whisper' },
      { act: 'say', text: '아무 일도 일어나지 않았다.' },
      { act: 'say', text: '손끝이 잠깐 차가워졌다가 만다.' },
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* ── 깜놀 ──────────────────────────────────────────
     무엇이 올지는 그때 정한다. 적은 사람도 모른다. */
  fireScare() {
    // 방심할 틈도 없이 터지면 놀라지 않는다. 연달아 터지면 개그가 된다.
    if (this.scares >= 2 || this.turn < 3 || this.turn - this.lastScare < 6) return;
    if (this.phantom) return;

    const kinds = ['face', 'behind', 'blackout', 'lie'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.scares++;
    this.lastScare = this.turn;

    if (kind === 'behind') { this.scareBehind(); return; }
    if (kind === 'lie') { this.scareLie(); return; }
    if (kind === 'blackout') { this.scareBlackout(); return; }
    this.scareFace();
  }

  /** 들리는 소리. 크기로 놀래키지 않는다 — 다른 소리와 같은 범위를 지킨다. */
  stinger() {
    if (this.fx.has('deaf')) return;
    this.audio.noise(0.22, 0.16);
    this.audio.blip(62, 0.5, 'sawtooth', 0.11);
  }

  scareFace() {
    this.stinger();
    // 이 방의 괴물 얼굴이다. 방명록이 괴물 모습을 정하니 방마다 다르다.
    const look = this.w.monsterLook;
    this.hooks.onScare?.({ kind: 'face', img: look?.img || null, emoji: look?.emoji || null, calm: this.calm });
    this.log('시야 가장자리에서 무언가가 스쳤다.', 'bad');
  }

  scareBlackout() {
    this.stinger();
    this.frozen = true;
    this.hooks.onScare?.({ kind: 'blackout', calm: this.calm });
    this.log('불이 전부 꺼졌다.', 'bad');
    setTimeout(() => {
      this.log('무언가 숨을 쉬고 있다.', 'sys');
      setTimeout(() => {
        if (this.dead || this.won) return;
        this.frozen = false;
        this.pushState();
        this.describe();
      }, 900);
    }, 700);
    this.pushState();
  }

  scareLie() {
    this.lieUntil = this.turn + 1;
    this.audio.blip(140, 0.18, 'sine', 0.05);
    this.pushState();
  }

  /**
   * 등 뒤에 세운다. 판 위의 괴물이 아니라 유령이라, 괴물이 하나도 없는 방에서도
   * 똑같이 선다. 돌아보면 0.2초 마주치고 사라진다.
   */
  scareBehind() {
    const back = (this.facing + 2) % 4;
    const [dx, dy] = DIRS[back];
    const c = { x: this.cx + dx, y: this.cy + dy };
    if (this.wall(c.x, c.y)) { this.scareFace(); return; }   // 뒤가 벽이면 다른 걸로
    this.phantom = { x: c.x, y: c.y, seenAt: 0, until: this.turn + 4 };
    if (!this.fx.has('deaf')) this.audio.blip(70, 0.35, 'sine', 0.05);
    this.log('등 뒤에서 숨소리가 난다.', 'bad');
  }

  /** 카메라가 유령 쪽으로 돌아앉았는가. 돌아보는 중간에 사라지면 아무도 못 본다. */
  checkPhantom() {
    const p = this.phantom;
    if (!p) return;
    const now = performance.now();

    if (p.seenAt) {
      if (now - p.seenAt > 200) {
        this.phantom = null;
        this.log('아무것도 없다.', 'sys');
      }
      return;
    }
    // 돌아보지 않으면 조용히 사라진다
    if (this.turn > p.until) { this.phantom = null; return; }

    let d = this.facing * (Math.PI / 2) - this.angle;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    if (Math.abs(d) > 0.12) return;                       // 아직 돌아앉는 중

    const [fx, fy] = DIRS[this.facing];
    if (this.cx + fx !== p.x || this.cy + fy !== p.y) return;

    p.seenAt = now;
    this.stinger();
    this.hooks.onScare?.({ kind: 'behind', calm: this.calm });
  }

  teleport(to) {
    let c = null;
    if (to === 'start') c = { x: 1, y: 1 };
    else if (to === 'exit' && this.w.exit) c = { x: this.w.exit.x, y: this.w.exit.y };
    if (c && this.monsterAt(c.x, c.y)) c = null;   // 괴물이 선 칸이면 아무 데나
    if (!c) {
      const cells = [];
      for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.wall(x, y) && !this.monsterAt(x, y)) cells.push({ x, y });
      c = cells[Math.floor(Math.random() * cells.length)];
    }
    if (!c) return;
    this.cx = c.x; this.cy = c.y; this.px = c.x + 0.5; this.py = c.y + 0.5;
    this.event = null;
    this.log('눈을 깜빡이자 다른 곳에 서 있다.', 'bad');
    this.reveal();
    this.checkTrap();
  }

  ruleMonsters(a) {
    const live = this.monsters.filter((m) => m.alive);
    if (a.do === 'spawn') {
      const far = [];
      for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
        if (!this.wall(x, y) && !this.monsterAt(x, y) && Math.abs(x - this.cx) + Math.abs(y - this.cy) >= 4) far.push({ x, y });
      }
      let made = 0;
      for (let k = 0; k < a.count && far.length; k++, made++) {
        const c = far.splice(Math.floor(Math.random() * far.length), 1)[0];
        this.monsters.push({ id: `rm${this.monsters.length}`, x: c.x, y: c.y, alive: true, stun: 0 });
      }
      if (made) this.log('어딘가에서 무언가 늘어났다.', 'bad');
    } else if (a.do === 'flee') { for (const m of live) this.fleeMonster(m); this.log('기척들이 멀어진다.'); }
    else if (a.do === 'stun') { for (const m of live) m.stun = 2; this.log('모든 소리가 멎었다.'); }
    else { for (const m of live) m.stun = -1; this.log('어둠 속이 술렁인다.', 'bad'); }
  }

  ruleGive(a) {
    if (a.item === 'pistol') {
      this.hasPistol = true; this.rangedName = '권총'; this.rangedIsPistol = true; this.ammo += 12;
      this.log(`손에 권총이 쥐어져 있다. 탄약 ${this.ammo}발.`);
    } else if (a.item === 'knife') { this.hasKnife = true; this.meleeName = '칼'; this.log('손에 칼이 쥐어져 있다.'); }
    else if (a.item === 'map') { this.mapKnown = true; this.mm.style.display = ''; this.log('주머니에 지도가 들어 있다.'); }
    else { this.ammo += a.count; this.log(`탄약이 ${a.count}발 늘었다.`); }
  }

  /** 규칙의 대상 중 가장 가까운 하나에게만 일어난다. */
  ruleObject(how, target) {
    const dist = (x) => Math.abs(x.x - this.cx) + Math.abs(x.y - this.cy);
    const o = this.objects.filter((x) => !x.taken && x.key === target).sort((p, q) => dist(p) - dist(q))[0];
    if (!o) return;
    if (how === 'vanish') { o.taken = true; return; }
    if (o.where === 'wall') return;                       // 벽에 걸린 것은 움직이지 않는다
    if (how === 'follow' || how === 'wander') { o.moves = how; o.pose = 'stand'; return; }
    const spot = DIRS.map(([dx, dy]) => ({ x: this.cx + dx, y: this.cy + dy })).find((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y));
    if (spot) { o.x = spot.x; o.y = spot.y; }            // come
  }

  encounterCtx() {
    return { effects: this.fx, corpse: this.carriedCorpse > 0, weapon: this.hasKnife || (this.hasPistol && this.ammo > 0) };
  }

  specialFor(key, kind) {
    if (!this.specials.has(key)) this.specials.set(key, pickSpecial(kind, this.encounterCtx()));
    return this.specials.get(key);
  }

  /** 앞 칸 함정을 알아챘는가. 지도에 표시되면 항상, 아니면 5%. 함정마다 한 번만 굴린다. */
  trapAhead() {
    const a = this.ahead();
    const t = this.traps.find((t) => !t.sprung && t.x === a.x && t.y === a.y);
    if (!t) return null;
    if (!this.noticed.has(t.id)) this.noticed.set(t.id, this.s.mapTraps || Math.random() < 0.05);
    return this.noticed.get(t.id) ? t : null;
  }

  /** 몸을 피한다. 성공하면 옆(없으면 뒤) 빈 칸으로, 그 턴에 괴물은 물지 못한다. */
  dodge() {
    const sight = this.monsterInSight(1);
    if (!sight) return;
    if (Math.random() < dodgeChance(this.fx)) {
      this.applyMove(this.sideCell() ? 'side' : 'back');
      sight.m.stun = 1;
      this.log('몸을 틀었다. 그것의 손이 어깨를 스친다.');
      if (!this.dead) this.describe();
    } else {
      this.damage(this.s.noPain ? 0 : COMBAT.dodgeFailDamage, '피하지 못했다.');
      sight.m.stun = 1;   // 스친 것으로 그 턴은 끝난다
    }
  }

  avoidTrap() {
    const t = this.trapAhead();
    if (!t) return;
    if (Math.random() < 0.75) {
      const moved = this.applyMove('over', t);
      this.log(moved ? '틈을 피해 조심스럽게 지나갔다.' : '틈 너머로 디딜 곳이 없다. 가장자리에 발을 걸친 채 멈춰 섰다.');
      if (!this.dead) this.describe();
    } else this.springTrap(t);
  }

  special(key) {
    const sp = this.specials.get(key);
    if (!sp) return;
    const monster = this.monsters.find((m) => m.id === key);
    const trap = this.traps.find((t) => t.id === key);
    this.specials.delete(key);          // 한 번 쓴 특수 행동은 다시 뜨지 않는다 (다음 조우에 새로 뽑는다)
    this.applyOutcome(resolve(sp.outcomes), { monster, trap });
  }

  eventChoice(i) {
    const ev = EVENTS[this.event.id];
    const choice = ev.choices[i];
    const ctx = { monster: this.event.monster };
    this.event = null;
    if (choice) this.applyOutcome(resolve(choice.outcomes), ctx);
  }

  applyOutcome(r, { monster, trap } = {}) {
    if (r.text) this.log(r.text, r.damage || r.losePart || r.trap === 'spring' ? 'bad' : '');
    if (r.useCorpse && this.carriedCorpse > 0) this.carriedCorpse--;
    if (r.move) this.applyMove(r.move, trap);
    if (r.damage) this.damage(this.s.noPain ? 0 : r.damage);
    if (this.dead) return;
    if (r.losePart) this.losePart(r.losePart);
    if (this.dead) return;
    if (monster && r.monster === 'stun') monster.stun = 2;
    if (monster && r.monster === 'enrage') monster.stun = -1;   // 다음 턴에 한 칸 더
    if (monster && r.monster === 'flee') this.fleeMonster(monster);
    if (trap && r.trap === 'disarm') trap.sprung = true;
    if (trap && r.trap === 'spring') this.springTrap(trap);
    if (r.turns) this.pendingTurns = r.turns;
    if (r.next) { this.event = { id: r.next, monster }; this.log(EVENTS[r.next].text, 'bad'); }
    else if (!this.dead) this.describe();
  }

  sideCell() {
    for (const t of [1, 3]) {
      const [dx, dy] = DIRS[(this.facing + t) % 4];
      const x = this.cx + dx, y = this.cy + dy;
      if (!this.wall(x, y) && !this.monsterAt(x, y)) return { x, y };
    }
    return null;
  }

  applyMove(kind, trap) {
    let c = null;
    if (kind === 'side') c = this.sideCell();
    if (kind === 'back' || (kind === 'side' && !c)) {
      const [dx, dy] = DIRS[(this.facing + 2) % 4];
      const b = { x: this.cx + dx, y: this.cy + dy };
      if (!this.wall(b.x, b.y) && !this.monsterAt(b.x, b.y)) c = b;
    }
    if (kind === 'over' && trap) {
      const [dx, dy] = DIRS[this.facing];
      const beyond = { x: trap.x + dx, y: trap.y + dy };
      c = (!this.wall(beyond.x, beyond.y) && !this.monsterAt(beyond.x, beyond.y)) ? beyond : null;
    }
    if (c) { this.cx = c.x; this.cy = c.y; this.reveal(); this.checkTrap(); }
    return !!c;
  }

  springTrap(t) {
    t.sprung = true;
    this.losePart('random', '함정이다. 바닥에서 솟은 것이 몸을 꿰뚫었다.');
  }

  /** 3칸 멀어지는 쪽으로 물러난다. */
  fleeMonster(m) {
    for (let i = 0; i < 3; i++) {
      const opts = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
        .filter((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y) && !(c.x === this.cx && c.y === this.cy))
        .sort((a, b) => (Math.abs(b.x - this.cx) + Math.abs(b.y - this.cy)) - (Math.abs(a.x - this.cx) + Math.abs(a.y - this.cy)));
      if (!opts.length) break;
      m.x = opts[0].x; m.y = opts[0].y;
    }
    m.stun = 1;
  }

  throwBait() {
    if (this.carriedCorpse <= 0) return;
    this.carriedCorpse--;
    const a = this.ahead();
    const spot = this.wall(a.x, a.y) ? { x: this.cx, y: this.cy } : a;
    this.baits.push({ x: spot.x, y: spot.y, life: 6 });
    this.log('시체를 던졌다. 무언가가 그쪽으로 몰려간다.');
  }

  checkTrap() {
    const t = this.traps.find((t) => !t.sprung && t.x === this.cx && t.y === this.cy);
    if (!t) return;
    this.springTrap(t);
  }

  tryExit() {
    if (this.s.exitCost !== 'random_body_part') { this.escape(); return; }
    const part = pickPart(this.allLost);
    // 요구하는 부위를 이미 잃었으면 영영 열리지 않는다. 다 잘려도 마찬가지다.
    if (!part) { this.log('더 내려놓을 것이 없다. 문은 열리지 않는다.', 'bad'); return; }
    this.lostParts.push(part);

    if (part === this.w.demandedPart) {
      this.log(`${part}을(를) 내려놓았다. 문이 열린다.`);
      this.escape();
      return;
    }
    if (this.s.noPain) {
      this.log(`${part}을(를) 잘라 내려놓았다. 아프지 않다. 문은 그대로다.`, 'sys');
    } else {
      this.damage(severityOf(part), `${part}을(를) 잘라 내려놓았다. 문은 열리지 않는다.`);
    }
    if (this.fx.has('deaf')) this.audio.muted = true;
  }

  /** 번호판 결과. 서버가 맞다고 해야 열린다. */
  unlockResult(ok) {
    if (this.dead || this.won) return;
    if (ok) {
      this.unlocked = true;
      this.audio.door();
      this.log('딸깍. 잠금이 풀렸다.');
      this.pushState();
      return;
    }
    // 틀려도 체력은 깎지 않는다. 대신 소리가 난다 — 그 소리를 듣고 모인다.
    if (!this.fx.has('deaf')) this.audio.blip(150, 0.3, 'square', 0.09);
    this.log('맞지 않는다. 헛도는 소리가 복도를 타고 퍼진다.', 'bad');
    this.baits.push({ x: this.cx, y: this.cy, life: 3 });
    this.endTurn();
    this.pushState();
  }

  escape() {
    if (this.won || this.dead) return;
    this.won = true;
    this.audio.door();
    this.hooks.onEnd?.({
      won: true,
      lostParts: this.allLost,
      healed: this.s.healOnExit && this.allLost.length > 0,
      turns: this.turn,
    });
  }

  /** 부위 하나를 잃는다. effect 를 주면 그 효과의 부위를 먼저. 치명도만큼 체력이 깎인다. */
  losePart(effect, how) {
    const part = pickPart(this.allLost, Math.random, effect === 'random' ? undefined : effect);
    if (!part) { this.damage(30, `${how || ''} 더 내줄 것이 없다.`.trim()); return null; }
    this.lostParts.push(part);
    const line = `${how ? `${how} ` : ''}${part}을(를) 잃었다.`;
    if (this.s.noPain) this.log(`${line} 아프지 않다.`, 'sys');
    else this.damage(severityOf(part), line);
    if (this.fx.has('deaf')) this.audio.muted = true;
    return part;
  }

  damage(amount, msg) {
    if (msg) this.log(msg, 'bad');
    if (this.s.noPain || amount <= 0) return;
    this.hp -= amount;
    this.audio.hurt();
    this.hooks.onHit?.();
    if (this.hp <= 0) { this.hp = 0; this.die(msg || '죽었다.'); }
  }

  die(reason) {
    if (this.dead || this.won) return;
    this.dead = true;
    this.hooks.onEnd?.({ won: false, reason, lostParts: this.allLost, x: this.cx, y: this.cy });
  }

  /* ── 턴 넘기기 ─────────────────────────────────── */
  endTurn() {
    const fresh = this.freshTurn === this.turn;
    this.freshTurn = -1;
    this.turn++;
    if (!fresh && this.darkTurns > 0) this.darkTurns--;
    if (!fresh && this.revealTurns > 0 && --this.revealTurns === 0 && !this.mapKnown) this.mm.style.display = 'none';
    this.moveMonsters();
    if (this.dead) return;
    this.moveObjects();

    for (const b of this.baits) b.life--;
    this.baits = this.baits.filter((b) => b.life > 0);

    if (this.s.shifting && this.turn % 8 === 0) this.shiftMaze();
  }

  /** 따라오거나 돌아다니는 물체. 해가 없고 길을 막지 않는다. */
  moveObjects() {
    const isFloor = (x, y) => !this.wall(x, y);
    for (const o of this.objects) {
      if (o.taken || o.where === 'wall' || o.moves === 'still') continue;
      const n = o.moves === 'follow'
        ? nextStep(isFloor, o, { x: this.cx, y: this.cy })
        : wanderStep(isFloor, o);
      if (n) { o.x = n.x; o.y = n.y; }
    }
  }

  moveMonsters() {
    const base = monsterSteps(this.s.monsterSpeed || 1);
    // 이번 턴에 괴물마다 움직일 칸 수. 기절이면 0, 격분이면 한 칸 더.
    for (const m of this.monsters) m.moves = m.stun > 0 ? 0 : base + (m.stun < 0 ? 1 : 0);
    for (let s = 0; s <= base; s++) {
      for (const m of this.monsters) {
        if (!m.alive || this.dead || m.moves <= 0) continue;
        m.moves--;

        // 바로 옆이면 문다. 같은 칸으로 들어오지 않는다 — 마주 서야 피하거나 맞설 수 있다.
        if (Math.abs(m.x - this.cx) + Math.abs(m.y - this.cy) <= 1) {
          this.bite(m);
          continue;
        }

        const bait = this.baits[0];
        const tx = bait ? bait.x : this.cx;
        const ty = bait ? bait.y : this.cy;
        const d = Math.abs(tx - m.x) + Math.abs(ty - m.y);
        if (!bait && d > 7) continue;                       // 멀면 관심 없다
        if (!bait && !this.los(m.x, m.y, this.cx, this.cy)) continue;

        const opts = DIRS
          .map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
          .filter((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y) && !(c.x === this.cx && c.y === this.cy))
          .sort((a, b) =>
            (Math.abs(tx - a.x) + Math.abs(ty - a.y)) - (Math.abs(tx - b.x) + Math.abs(ty - b.y)));
        if (opts.length && (Math.abs(tx - opts[0].x) + Math.abs(ty - opts[0].y)) < d) {
          m.x = opts[0].x; m.y = opts[0].y;
        }
      }
    }
    for (const m of this.monsters) { if (m.stun > 0) m.stun--; else if (m.stun < 0) m.stun = 0; }
    const near = this.monsters.filter((m) => m.alive)
      .some((m) => Math.abs(m.x - this.cx) + Math.abs(m.y - this.cy) <= 3);
    if (near && !this.fx.has('deaf')) { this.audio.growl(); this.log('숨소리가 가깝다.', 'bad'); }
  }

  /** 물었으면 그 턴은 거기서 멈춘다. 가끔은 살점을 뜯어 간다. */
  bite(m) {
    m.moves = 0;
    this.damage(this.s.noPain ? 0 : 22, '그것이 당신을 물어뜯었다.');
    if (!this.dead && Math.random() < COMBAT.counterPartChance) this.losePart('random', '그것이 살점을 뜯어 갔다.');
  }

  los(x0, y0, x1, y1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.wall(Math.floor(x0 + (x1 - x0) * t + 0.5), Math.floor(y0 + (y1 - y0) * t + 0.5))) return false;
    }
    return true;
  }

  /* ── 묘사 ─────────────────────────────────────── */
  describe() {
    const bits = [];
    const a = this.ahead();
    const blind = this.fx.has('blind');

    if (this.atExit()) {
      bits.push('문이 눈앞에 있다.');
    } else if (this.wall(a.x, a.y)) {
      bits.push('앞은 막혀 있다.');
    } else {
      let n = 0;
      const [dx, dy] = DIRS[this.facing];
      while (n < 12 && !this.wall(this.cx + dx * (n + 1), this.cy + dy * (n + 1))) n++;
      bits.push(blind ? '앞이 잘 보이지 않는다.' : n >= 5 ? '긴 복도가 어둠 속으로 이어진다.' : `${DIR_NAME[this.facing]}쪽으로 길이 이어진다.`);
      if (!blind && this.w.exit && this.cx + dx * n === this.w.exit.x && this.cy + dy * n === this.w.exit.y) {
        bits.push('복도 끝에서 희미한 빛이 새어 나온다.');
      }
    }

    const sight = this.monsterInSight();
    if (sight && (!blind || sight.dist === 1)) {
      bits.push(blind ? '바로 앞에 무언가 있다.' : sight.dist === 1
        ? '바로 앞에 그것이 서 있다.'
        : `${sight.dist}걸음 앞에 무언가 웅크리고 있다.`);
    }

    const it = this.itemHere();
    if (it) bits.push(`발밑에 ${ITEM_NAME[it.kind] || '무언가'}이(가) 놓여 있다.`);
    if (this.corpseHere()) bits.push('바닥에 시체가 널브러져 있다.');
    if (this.traps.some((t) => !t.sprung && this.s.mapTraps && t.x === a.x && t.y === a.y)) {
      bits.push('지도에 따르면 앞 칸에 함정이 있다.');
    } else if (this.trapAhead()) {
      bits.push('앞 바닥에 이상한 틈이 보인다.');
    }
    const withDesc = (line, o) => (o.desc ? `${line} ${o.desc}` : line);
    const floorObj = (x, y) => this.objects.find((o) => !o.taken && o.where !== 'wall' && o.x === x && o.y === y);
    const here = floorObj(this.cx, this.cy);
    if (here) bits.push(withDesc(`${here.name}이(가) 있다.`, here));
    if (this.wall(a.x, a.y)) {
      const face = (this.facing + 2) % 4;
      const onWall = this.objects.filter((o) => o.where === 'wall' && o.x === a.x && o.y === a.y && o.face === face);
      if (onWall.length) bits.push(withDesc(`벽에 ${onWall[0].name}이(가) 걸려 있다.`, onWall[0]));
    } else {
      const front = floorObj(a.x, a.y);
      if (front) bits.push(blind ? '앞에 무언가 있다.' : withDesc(`앞에 ${front.name} 같은 것이 있다.`, front));
    }

    this.log(bits.join(' '));
  }

  reveal() {
    const r = 2;
    for (let y = this.cy - r; y <= this.cy + r; y++) {
      for (let x = this.cx - r; x <= this.cx + r; x++) {
        if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.seen[y][x] = true;
      }
    }
  }

  shiftMaze() {
    const backup = this.grid.map((r) => r.slice());
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(Math.random() * (this.size - 2));
      const y = 1 + Math.floor(Math.random() * (this.size - 2));
      if ((x === this.cx && y === this.cy) || (this.w.exit && x === this.w.exit.x && y === this.w.exit.y)) continue;
      if (this.pinned(x, y)) continue;
      this.grid[y][x] = this.grid[y][x] === 1 ? 0 : 1;
    }
    if (this.w.exit && !this.reachable(this.cx, this.cy, this.w.exit.x, this.w.exit.y)) {
      this.grid = backup;
      return;
    }
    this._door = null;   // 문이 기댈 벽이 바뀌었을 수 있다
    this.log('벽이 움직이는 소리가 난다.', 'sys');
  }

  /** 움직이는 미로가 건드리면 안 되는 칸. 물건이 놓인 바닥, 무언가 걸린 벽. */
  pinned(x, y) {
    const at = (o) => o.x === x && o.y === y;
    return this.objects.some((o) => !o.taken && at(o))
      || this.items.some((it) => !it.taken && at(it))
      || this.corpses.some((c) => !c.taken && at(c))
      || this.traps.some((t) => !t.sprung && at(t))
      || this.monsters.some((m) => m.alive && at(m));
  }

  reachable(sx, sy, tx, ty) {
    const seen = new Set([`${sx},${sy}`]);
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      if (x === tx && y === ty) return true;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (this.wall(nx, ny) || seen.has(key)) continue;
        seen.add(key); q.push([nx, ny]);
      }
    }
    return false;
  }

/* ── 렌더 ─────────────────────────────────────── */
  /** 벽·바닥에 붙은 그림 목록을 다시 만든다. 이미지가 늦게 도착해도 따라잡도록 가끔 부른다. */
  rebuildDecals() {
    const pix = (img, emoji) => {
      const cv = sprite(img);
      return decalPixels(cv ? `${img}` : `e:${emoji}`, cv, emoji);
    };
    this.wallDecals = new Map();
    for (const o of this.objects) {
      if (o.where !== 'wall') continue;
      const k = (o.y * this.size + o.x) * 4 + o.face;
      if (!this.wallDecals.has(k)) this.wallDecals.set(k, []);
      this.wallDecals.get(k).push(pix(o.img, o.emoji));
    }
    this.floorDecal.fill(-1);
    this.floorDecals = [];
    const lay = (x, y, p) => {
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
      this.floorDecal[y * this.size + x] = this.floorDecals.push(p) - 1;
    };
    // 눕혀 칠하는 건 손댈 일 없는 배경뿐이다.
    for (const o of this.objects) {
      if (!o.taken && o.where !== 'wall' && o.pose === 'lie' && !this.hot.has(o.key)) lay(o.x, o.y, pix(o.img, o.emoji));
    }
  }

  /**
   * 형광등 깜빡임. 가끔 0.1~0.3초 어두워진다.
   * "가끔 ~했으면" 같은 소원은 이 박자에 얹는다 — 방이 이미 제 주기를 갖고 있으니
   * 따로 숫자를 정해 주는 것보다 이쪽이 자연스럽다.
   */
  flicker() {
    const now = performance.now();
    if (now > this.flickerUntil && Math.random() < 0.004) {
      this.flickerUntil = now + 100 + Math.random() * 200;
      if (!this.dead && !this.won && !this.frozen) {
        const acts = this.rules.flicker();
        if (acts.length) { this.doActions(acts); this.pushState(); }
      }
    }
    return now < this.flickerUntil ? 0.55 : 1;
  }

  render() {
    const { rw, rh, img } = this;
    const data = img.data;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;
    const T = this.tex;
    const blind = this.fx.has('blind');
    const half = rh / 2;
    const fogDist = blind ? 1.2 : 6.5;
    const dark = blind ? 0.35 : 1;
    const light = this.flicker() * dark;
    if (T && this.decalFrame-- <= 0) { this.rebuildDecals(); this.decalFrame = 30; }

    // 안개와 섞어 찍는다.
    const put = (i, r, g, b, fog, k) => {
      data[i] = r * k * (1 - fog) + FOG[0] * dark * fog;
      data[i + 1] = g * k * (1 - fog) + FOG[1] * dark * fog;
      data[i + 2] = b * k * (1 - fog) + FOG[2] * dark * fog;
      data[i + 3] = 255;
    };

    if (!T) {
      // 텍스처가 오기 전: 예전 단색
      for (let y = 0; y < rh; y++) {
        const top = y < half;
        const base = top ? COLORS.ceil : COLORS.floor;
        const k = top ? y / half : 1 - (y - half) / half;
        const f = (0.35 + k * 0.65) * dark;
        for (let x = 0; x < rw; x++) {
          const i = (y * rw + x) * 4;
          data[i] = base[0] * f; data[i + 1] = base[1] * f; data[i + 2] = base[2] * f; data[i + 3] = 255;
        }
      }
    } else {
      // 바닥·천장 (floor casting). 천장 줄은 바닥 줄과 대칭이다.
      const rdx0 = dirX - planeX, rdy0 = dirY - planeY, rdx1 = dirX + planeX, rdy1 = dirY + planeY;
      const size = this.size;
      for (let y = Math.floor(half); y < rh; y++) {
        const p = y - half + 0.5;
        const rowDist = half / p;
        const sx = rowDist * (rdx1 - rdx0) / rw, sy = rowDist * (rdy1 - rdy0) / rw;
        let fx = this.px + rowDist * rdx0, fy = this.py + rowDist * rdy0;
        const fog = Math.min(1, rowDist / fogDist);
        const yc = rh - 1 - y;
        for (let x = 0; x < rw; x++) {
          const cx = Math.floor(fx), cy = Math.floor(fy);
          const lu = fx - cx, lv = fy - cy;
          const ti = ((((lv * TEX) | 0) & (TEX - 1)) * TEX + (((lu * TEX) | 0) & (TEX - 1))) * 4;
          let r = T.floor[ti], g = T.floor[ti + 1], b = T.floor[ti + 2];
          const di = (cx >= 0 && cy >= 0 && cx < size && cy < size) ? this.floorDecal[cy * size + cx] : -1;
          if (di >= 0 && lu > 0.15 && lu < 0.85 && lv > 0.15 && lv < 0.85) {
            const dp = this.floorDecals[di];
            const j = ((((lv - 0.15) / 0.7 * dp.size) | 0) * dp.size + (((lu - 0.15) / 0.7 * dp.size) | 0)) * 4;
            const a = dp.data[j + 3] / 255;
            r = r * (1 - a) + dp.data[j] * a; g = g * (1 - a) + dp.data[j + 1] * a; b = b * (1 - a) + dp.data[j + 2] * a;
          }
          put((y * rw + x) * 4, r, g, b, fog, light);
          if (yc >= 0) {
            // 형광등은 칸의 타일 한 장에만. 그 타일 안에서 패널 텍스처를 한 장 그대로 편다.
            const lit = lightTile(cx, cy) === (lu >= 0.5 ? 1 : 0) + (lv >= 0.5 ? 2 : 0);
            if (lit) {
              const li = ((((lv * 2 % 1) * TEX) | 0) * TEX + (((lu * 2 % 1) * TEX) | 0)) * 4;
              put((yc * rw + x) * 4, T.light[li], T.light[li + 1], T.light[li + 2], fog * 0.4, light);   // 안개를 덜 탄다
            } else {
              put((yc * rw + x) * 4, T.ceil[ti], T.ceil[ti + 1], T.ceil[ti + 2], fog, light);
            }
          }
          fx += sx; fy += sy;
        }
      }
    }

    // 벽 (DDA)
    this.zBuf.length = rw;
    for (let x = 0; x < rw; x++) {
      const camX = (2 * x) / rw - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;

      let mapX = Math.floor(this.px), mapY = Math.floor(this.py);
      const ddx = Math.abs(1 / (rdx || 1e-9));
      const ddy = Math.abs(1 / (rdy || 1e-9));
      let stepX, stepY, sdx, sdy;

      if (rdx < 0) { stepX = -1; sdx = (this.px - mapX) * ddx; }
      else { stepX = 1; sdx = (mapX + 1 - this.px) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (this.py - mapY) * ddy; }
      else { stepY = 1; sdy = (mapY + 1 - this.py) * ddy; }

      let side = 0, hit = false, guard = 0;
      while (!hit && guard++ < 256) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= this.size || mapY >= this.size) { hit = true; break; }
        if (this.grid[mapY][mapX] === 1) hit = true;
      }

      const dist = side === 0 ? sdx - ddx : sdy - ddy;
      const d = Math.max(0.05, dist);
      this.zBuf[x] = d;

      const lineH = rh / d;
      const yTop = half - lineH / 2;
      const y0 = Math.max(0, Math.floor(yTop));
      const y1 = Math.min(rh - 1, Math.floor(half + lineH / 2));

      if (!T) {
        const base = side === 1 ? COLORS.wallDark : COLORS.wallLight;
        const fog = Math.max(0.14, Math.min(1, (blind ? 1.2 : 5.0) / d));
        for (let y = y0; y <= y1; y++) {
          const i = (y * rw + x) * 4;
          data[i] = base[0] * fog; data[i + 1] = base[1] * fog; data[i + 2] = base[2] * fog; data[i + 3] = 255;
        }
        continue;
      }

      let wallX = side === 0 ? this.py + d * rdy : this.px + d * rdx;
      wallX = wallU(side, rdx, rdy, wallX - Math.floor(wallX));   // 어느 쪽에서 봐도 거울상이 되지 않게
      const tu = Math.min(TEX - 1, (wallX * TEX) | 0);
      const fog = Math.min(1, d / fogDist);
      const k = light * (side ? 0.8 : 1);

      // 이 벽면에 걸린 것
      let decal = null, du = 0;
      const list = this.wallDecals.get((mapY * this.size + mapX) * 4 + faceOf(side, stepX, stepY));
      if (list && wallX >= 0.2 && wallX <= 0.8) {
        const sl = (wallX - 0.2) / 0.6 * list.length;
        const idx = Math.min(list.length - 1, Math.floor(sl));
        decal = list[idx]; du = Math.min(0.999, sl - idx);
      }

      for (let y = y0; y <= y1; y++) {
        const v = (y - yTop) / lineH;
        const ti = ((((v * TEX) | 0) & (TEX - 1)) * TEX + tu) * 4;
        let r = T.wall[ti], g = T.wall[ti + 1], b = T.wall[ti + 2];
        if (decal && v >= 0.22 && v < 0.72) {
          const j = ((((v - 0.22) / 0.5 * decal.size) | 0) * decal.size + ((du * decal.size) | 0)) * 4;
          const a = decal.data[j + 3] / 255;
          r = r * (1 - a) + decal.data[j] * a; g = g * (1 - a) + decal.data[j + 1] * a; b = b * (1 - a) + decal.data[j + 2] * a;
        }
        put((y * rw + x) * 4, r, g, b, fog, k);
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.drawSprites();
    this.drawDust();
    if (this.darkTurns > 0) { this.ctx.fillStyle = 'rgba(0,0,0,0.92)'; this.ctx.fillRect(0, 0, rw, rh); }
  }

  collectSprites() {
    const out = [];
    // 마주친 0.2초 동안만 보인다
    if (this.phantom?.seenAt) {
      const look = this.w.monsterLook;
      out.push({
        kind: 'monster',
        ref: look && (look.img || look.emoji !== '❔') ? { ...look, id: 'monster' } : null,
        x: this.phantom.x + 0.5, y: this.phantom.y + 0.5, h: 1.15, w: 0.8,
      });
    }
    for (const m of this.monsters) {
      const look = this.w.monsterLook && (this.w.monsterLook.img || this.w.monsterLook.emoji !== '❔') ? this.w.monsterLook : null;
      if (m.alive) out.push({ kind: 'monster', ref: look ? { ...look, id: 'monster' } : null, x: m.x + 0.5, y: m.y + 0.5, h: 1.05, w: 0.75 });
    }
    for (const c of this.corpses) {
      if (!c.taken) out.push({ kind: 'corpse', x: c.x + 0.5, y: c.y + 0.5, h: 0.3, w: 0.85, ground: true });
    }
    for (const b of this.baits) {
      out.push({ kind: 'corpse', x: b.x + 0.5, y: b.y + 0.5, h: 0.3, w: 0.85, ground: true });
    }
    if (!this.tex) {
      // 텍스처가 오기 전에는 벽·바닥 그림을 그릴 수 없으니 예전처럼 세워 둔다.
      for (const it of this.items) {
        if (it.taken) continue;
        out.push({ kind: it.kind, ref: it, x: it.x + 0.5, y: it.y + 0.5, h: 0.42, w: 0.42, ground: true });
      }
      for (const o of this.objects) {
        if (o.taken) continue;
        if (o.where === 'wall') {
          const [dx, dy] = DIRS[o.face];
          out.push({ kind: 'object', ref: o, x: o.x + 0.5 + dx * 0.55, y: o.y + 0.5 + dy * 0.55, h: 0.4, w: 0.45, lift: 0.28 });
        } else {
          out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.7, w: 0.6, ground: true });
        }
      }
    } else {
      // 벽 물체와 손댈 일 없는 누운 물체만 render() 가 벽과 바닥에 그린다.
      // 주울 수 있는 것은 언제나 세운다 — 바닥에 칠하면 글을 읽어야 무엇인지 안다.
      for (const it of this.items) {
        if (it.taken) continue;
        out.push({ kind: it.kind, ref: it, x: it.x + 0.5, y: it.y + 0.5, h: 0.42, w: 0.42, ground: true });
      }
      for (const o of this.objects) {
        if (o.taken || o.where === 'wall') continue;
        // 만질 수 있는 것은 누워 있어도 세운다. 고정된 판으로도 두지 않는다 —
        // 옆에서 보면 사라져서 무엇인지 알 수 없다.
        if (this.hot.has(o.key)) {
          out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.75, w: 0.65, ground: true });
          continue;
        }
        if (o.pose === 'lie') continue;
        if (o.moves === 'still') out.push({ kind: 'plane', ref: o, x: o.x + 0.5, y: o.y + 0.5 });
        else out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.7, w: 0.6, ground: true });
      }
    }
    for (const t of this.traps) {
      if (this.s.mapTraps && !t.sprung) {
        out.push({ kind: 'trap', x: t.x + 0.5, y: t.y + 0.5, h: 0.06, w: 0.95, ground: true });
      }
    }
    if (this.w.exit) {
      // 텍스처가 오면 문은 방향이 고정된 판이다. 그 전에는 예전처럼 세워 둔다.
      out.push(this.tex ? { kind: 'doorPlane', x: this.w.exit.x + 0.5, y: this.w.exit.y + 0.5 }
        : { kind: 'door', x: this.w.exit.x + 0.5, y: this.w.exit.y + 0.5, h: 0.92, w: 0.72 });
    }
    return out;
  }

  /**
   * 스프라이트는 픽셀 버퍼가 아니라 캔버스 2D 로 그린다.
   * 단색 덩어리 대신 실루엣을 그려야 그게 무엇인지 알아볼 수 있다.
   * 벽에 가려지는 건 z버퍼로 만든 클립 영역으로 처리한다.
   */
  drawSprites() {
    const { rw, rh } = this;
    const c = this.ctx;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    for (const o of this.objects) o.visible = false;
    const sprites = this.collectSprites()
      .map((s) => ({ ...s, d2: (s.x - this.px) ** 2 + (s.y - this.py) ** 2 }))
      .sort((a, b) => b.d2 - a.d2);

    for (const s of sprites) {
      if (s.kind === 'plane') { this.drawPlane(s.ref); continue; }
      if (s.kind === 'doorPlane') { const d = this.doorSegment(); this.drawSegment(d.ax, d.ay, d.bx, d.by, 'door', this.tex.doorCanvas, 0.92, false); continue; }
      const sx = s.x - this.px, sy = s.y - this.py;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.25) continue;
      if (this.fx.has('blind') && ty > 1.5) continue;

      const unit = Math.abs(rh / ty);
      const screenX = (rw / 2) * (1 + tx / ty);
      const w = unit * s.w;
      const h = unit * s.h;
      const floorY = rh / 2 + unit / 2;             // 이 거리에서 바닥이 닿는 높이
      const bottom = floorY - unit * (s.lift || 0);
      const top = bottom - h;

      const x0 = Math.floor(screenX - w / 2), x1 = Math.ceil(screenX + w / 2);
      if (x1 < 0 || x0 >= rw) continue;

      // 벽 뒤에 있는 열은 잘라낸다
      const runs = [];
      let runStart = -1;
      for (let x = Math.max(0, x0); x <= Math.min(rw - 1, x1); x++) {
        const vis = ty < this.zBuf[x];
        if (vis && runStart < 0) runStart = x;
        if (!vis && runStart >= 0) { runs.push([runStart, x - 1]); runStart = -1; }
      }
      if (runStart >= 0) runs.push([runStart, Math.min(rw - 1, x1)]);
      if (!runs.length) continue;

      let fog = Math.max(0.16, Math.min(1, 5.2 / ty));
      if (s.ground) fog *= 0.66;      // 바닥에 놓인 것은 빛이 잘 닿지 않는다

      c.save();
      c.beginPath();
      for (const [a, b] of runs) c.rect(a, 0, b - a + 1, rh);
      c.clip();
      if (s.kind === 'object') s.ref.visible = true;
      this.paintFogged(s, screenX, top, bottom, w, h, fog, ty);
      c.restore();
    }

    // 눈을 뗀 사이에 조금 옮겨 가 있다.
    for (const o of this.objects) {
      if (o.where !== 'wall' && o.wasVisible && !o.visible) {
        o.dx = (Math.random() - 0.5) * 0.3;
        o.dy = (Math.random() - 0.5) * 0.3;
      }
      o.wasVisible = o.visible;
    }
  }

  /**
   * 스프라이트를 작은 캔버스에 따로 그린 뒤, 그 픽셀에만 벽과 같은 안개를 덮어 화면에 옮긴다.
   * (화면에 바로 덮으면 뒤의 벽까지 두 번 흐려진다.)
   */
  paintFogged(s, screenX, top, bottom, w, h, fog, ty) {
    const main = this.ctx;
    const f = fogOf(ty, this.fx.has('blind'));
    const x0 = Math.max(0, Math.floor(screenX - w * 0.9)), x1 = Math.min(this.rw, Math.ceil(screenX + w * 0.9));
    const y0 = Math.max(0, Math.floor(top - h * 0.5)), y1 = Math.min(this.rh, Math.ceil(bottom + 2));
    const bw = x1 - x0, bh = y1 - y0;
    if (f < 0.02 || bw <= 0 || bh <= 0) { this.paintSprite(s.kind, screenX, top, bottom, w, fog, ty, s.ref); return; }
    if (!this.scratch) { this.scratch = document.createElement('canvas'); this.scratchCtx = this.scratch.getContext('2d'); }
    const sc = this.scratch, g = this.scratchCtx;
    if (sc.width < bw || sc.height < bh) { sc.width = Math.max(sc.width, bw); sc.height = Math.max(sc.height, bh); }
    g.clearRect(0, 0, bw, bh);
    g.save();
    g.translate(-x0, -y0);
    this.ctx = g;
    try { this.paintSprite(s.kind, screenX, top, bottom, w, fog, ty, s.ref); } finally { this.ctx = main; }
    g.restore();
    const dark = this.fx.has('blind') ? 0.35 : 1;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(${FOG.map((v) => Math.round(v * dark)).join(',')},${f.toFixed(3)})`;
    g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = 'source-over';
    main.drawImage(sc, 0, 0, bw, bh, x0, y0, bw, bh);
  }

  /** 방향이 고정된 판. 옆에서 보면 얇아지고, 나를 쳐다보지 않는다. */
  drawPlane(o) {
    const th = (o.stretch - 1.15) / 0.2 * Math.PI;           // id 로 정해진 각도 (0 ~ π)
    const hw = 0.32;
    const img = sprite(o.img);
    o.visible = this.drawSegment(
      o.x + 0.5 - Math.cos(th) * hw, o.y + 0.5 - Math.sin(th) * hw,
      o.x + 0.5 + Math.cos(th) * hw, o.y + 0.5 + Math.sin(th) * hw,
      img ? o.img : `e:${o.emoji}`, img || emojiCanvas(o.emoji), 0.7 * o.stretch, true);
  }

  /**
   * 문. 출구 칸으로 다가오는 쪽을 향해 방향이 고정된 판으로, 칸의 먼 쪽에 선다.
   * 막다른 복도면 끝 벽에 붙은 문처럼 보이고, 넓은 방이면 홀로 선 문틀이 된다.
   */
  doorSegment() {
    if (this._door) return this._door;
    const e = this.w.exit;
    const isFloor = (x, y) => !this.wall(x, y);
    const back = nextStep(isFloor, e, { x: 1, y: 1 })
      || DIRS.map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy })).find((c) => isFloor(c.x, c.y))
      || { x: e.x - 1, y: e.y };
    const dx = back.x - e.x, dy = back.y - e.y;               // 다가오는 쪽
    const cx = e.x + 0.5 - dx * 0.44, cy = e.y + 0.5 - dy * 0.44;
    const hx = -dy * 0.28, hy = dx * 0.28;                    // 다가오는 쪽과 수직, 폭 0.56칸
    // 다가오는 쪽에서 봤을 때 손잡이가 오른쪽에 오도록 끝점 순서를 잡는다
    this._door = { ax: cx + hx, ay: cy + hy, bx: cx - hx, by: cy - hy };
    return this._door;
  }

  /** 두 점 사이에 선 판을 열마다 그린다. 옆에서 보면 얇아지고, 안개를 받는다. 그렸으면 true. */
  drawSegment(ax, ay, bx, by, key, source, height, uncanny) {
    const { rw, rh } = this;
    const c = this.ctx;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;

    // 양 끝을 화면에 투영해 걸치는 열만 훑는다. 한쪽이 뒤에 있으면 전부.
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const screenX = (x, y) => {
      const sx = x - this.px, sy = y - this.py;
      const ty = invDet * (-planeY * sx + planeX * sy);
      return ty > 0.01 ? (rw / 2) * (1 + invDet * (dirY * sx - dirX * sy) / ty) : null;
    };
    const sa = screenX(ax, ay), sb = screenX(bx, by);
    if (sa === null && sb === null) return false;
    const x0 = (sa === null || sb === null) ? 0 : Math.max(0, Math.floor(Math.min(sa, sb)) - 1);
    const x1 = (sa === null || sb === null) ? rw - 1 : Math.min(rw - 1, Math.ceil(Math.max(sa, sb)) + 1);

    const blind = this.fx.has('blind');
    const fogColor = blind ? FOG.map((v) => v * 0.35) : FOG;
    let drawn = false;
    for (let x = x0; x <= x1; x++) {
      const camX = (2 * x) / rw - 1;
      const hit = raySegment(this.px, this.py, dirX + planeX * camX, dirY + planeY * camX, ax, ay, bx, by);
      if (!hit || hit.t >= this.zBuf[x] || hit.t < 0.2 || (blind && hit.t > 1.5)) continue;
      drawn = true;
      // 멀수록 어둡고 안개가 덮인다. 단계마다 미리 입힌 캔버스를 쓴다 (열마다 필터를 걸면 느리다).
      const src = filteredCanvas(key, source, Math.max(0.16, Math.min(1, 5.2 / hit.t)), fogOf(hit.t, blind), fogColor, uncanny);
      const unit = rh / hit.t;
      const bottom = rh / 2 + unit / 2;
      const top = bottom - unit * height;
      c.drawImage(src, Math.min(src.width - 1, (hit.s * src.width) | 0), 0, 1, src.height, x, top, 1, bottom - top);
    }
    return drawn;
  }

  drawDust() {
    const c = this.ctx;
    for (const p of this.dust) {
      c.fillStyle = `rgba(214, 198, 162, ${p.a * this.sway})`;
      c.beginPath();
      c.arc(p.x * this.rw, p.y * this.rh, p.r, 0, TAU);
      c.fill();
    }
  }

  paintSprite(kind, cx, top, bottom, w, fog, dist, ref) {
    const c = this.ctx;
    const h = bottom - top;
    const dim = (rgb, k = 1) => `rgb(${rgb.map((v) => Math.round(Math.min(255, v * fog * k))).join(',')})`;

    // 방명록 물체, 또는 모습이 준비된 아이템. 아이템은 모습이 없으면 아래의 도형으로 떨어진다.
    const canvas = sprite(ref?.img);
    if (kind === 'object' || canvas || (kind === 'monster' && ref)) {
      drawUncanny(c, { canvas, emoji: ref.emoji }, cx, bottom, w, h, fog, ref.stretch ?? stretchFor(ref.id));
      return;
    }

    if (kind === 'monster') {
      // 비쩍 마른 실루엣. 어깨가 좁고, 팔이 무릎보다 아래까지 내려온다.
      const ink = `rgba(5,3,3,${Math.min(0.97, 0.6 + fog * 0.4)})`;
      const shoulder = w * 0.34;
      const hip = w * 0.17;
      const headY = top + h * 0.13;
      const shoulderY = top + h * 0.26;

      c.fillStyle = ink;
      // 몸통
      c.beginPath();
      c.moveTo(cx - shoulder, shoulderY);
      c.quadraticCurveTo(cx - shoulder * 1.05, top + h * 0.6, cx - hip, bottom);
      c.lineTo(cx + hip, bottom);
      c.quadraticCurveTo(cx + shoulder * 1.05, top + h * 0.6, cx + shoulder, shoulderY);
      c.quadraticCurveTo(cx, top + h * 0.19, cx - shoulder, shoulderY);
      c.closePath();
      c.fill();

      // 앞으로 처진 머리
      c.beginPath();
      c.ellipse(cx, headY, w * 0.15, h * 0.1, 0, 0, TAU);
      c.fill();
      c.beginPath();                                   // 목
      c.moveTo(cx - w * 0.05, headY);
      c.lineTo(cx + w * 0.05, headY);
      c.lineTo(cx + w * 0.07, shoulderY);
      c.lineTo(cx - w * 0.07, shoulderY);
      c.closePath();
      c.fill();

      // 바닥까지 늘어진 팔
      c.strokeStyle = ink;
      c.lineWidth = Math.max(1.2, w * 0.062);
      c.lineCap = 'round';
      for (const side of [-1, 1]) {
        c.beginPath();
        c.moveTo(cx + side * shoulder * 0.9, shoulderY + h * 0.03);
        c.quadraticCurveTo(cx + side * w * 0.5, top + h * 0.62, cx + side * w * 0.33, bottom - h * 0.02);
        c.stroke();
      }

      // 눈. 작고 가깝게 붙어 있을수록 사람 같지 않다.
      const eyeR = Math.max(0.7, w * 0.028);
      c.fillStyle = `rgba(206,172,104,${Math.min(1, 0.4 + fog * 0.6)})`;
      for (const side of [-1, 1]) {
        c.beginPath();
        c.arc(cx + side * w * 0.062, headY - h * 0.01, eyeR, 0, TAU);
        c.fill();
      }
      return;
    }

    if (kind === 'door') {
      if (this.tex?.doorCanvas) {
        const x = cx - w / 2, y = bottom - h;
        c.save();
        c.filter = `brightness(${(fog * 0.9).toFixed(2)})`;
        c.drawImage(this.tex.doorCanvas, x, y, w, h);
        c.restore();
        c.fillStyle = `rgba(214,186,108,${0.4 + fog * 0.5})`;
        c.fillRect(x + w * 0.76, y + h * 0.52, Math.max(1.2, w * 0.05), Math.max(1.2, h * 0.04));   // 손잡이
        c.fillStyle = `rgba(230,210,140,${0.08 + fog * 0.12})`;
        c.fillRect(x, bottom - Math.max(1, h * 0.012), w, Math.max(1, h * 0.012));                   // 문틈 빛
        return;
      }
      const dw = w, dh = h;
      const x = cx - dw / 2, y = bottom - dh;
      // 문틈으로 새어 나오는 빛
      const g = c.createLinearGradient(x, y, x, bottom);
      g.addColorStop(0, dim([120, 98, 44], 1.1));
      g.addColorStop(0.55, dim([196, 164, 78], 1.15));
      g.addColorStop(1, dim([92, 74, 34]));
      c.fillStyle = g;
      c.fillRect(x, y, dw, dh);
      c.fillStyle = `rgba(10,8,7,${0.55 + fog * 0.35})`;
      c.fillRect(x + dw * 0.08, y + dh * 0.06, dw * 0.84, dh * 0.94);   // 문짝
      c.fillStyle = dim([214, 186, 108], 1.2);
      c.fillRect(x + dw * 0.72, y + dh * 0.52, Math.max(1.2, dw * 0.06), Math.max(1.2, dh * 0.05)); // 손잡이
      return;
    }

    if (kind === 'corpse') {
      // 웅크린 채 굳은 덩어리 + 뻗어 나온 팔
      c.fillStyle = dim([46, 42, 36]);
      c.beginPath();
      c.ellipse(cx, bottom - h * 0.35, w * 0.34, h * 0.5, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.ellipse(cx - w * 0.26, bottom - h * 0.2, w * 0.18, h * 0.34, 0.4, 0, TAU);
      c.fill();
      c.strokeStyle = dim([58, 52, 44]);
      c.lineWidth = Math.max(1, w * 0.06);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cx + w * 0.1, bottom - h * 0.3);
      c.lineTo(cx + w * 0.46, bottom - h * 0.06);
      c.stroke();
      return;
    }

    if (kind === 'pistol') {
      const s = w * 0.5;
      c.fillStyle = dim([158, 154, 142], 1.1);
      c.fillRect(cx - s * 0.55, bottom - h * 0.6, s * 1.1, Math.max(1.2, h * 0.24));   // 총열
      c.fillRect(cx - s * 0.1, bottom - h * 0.42, Math.max(1.2, s * 0.3), h * 0.42);   // 손잡이
      return;
    }

    if (kind === 'knife') {
      c.fillStyle = dim([186, 188, 194], 1.2);
      c.beginPath();
      c.moveTo(cx - w * 0.42, bottom - h * 0.18);
      c.lineTo(cx + w * 0.18, bottom - h * 0.52);
      c.lineTo(cx + w * 0.24, bottom - h * 0.34);
      c.lineTo(cx - w * 0.36, bottom - h * 0.02);
      c.closePath(); c.fill();
      c.fillStyle = dim([70, 52, 40]);
      c.fillRect(cx + w * 0.18, bottom - h * 0.5, w * 0.24, Math.max(1.2, h * 0.2));
      return;
    }

    if (kind === 'map') {
      c.fillStyle = dim([206, 196, 168], 1.15);
      c.beginPath();
      c.moveTo(cx - w * 0.4, bottom - h * 0.1);
      c.lineTo(cx - w * 0.28, bottom - h * 0.62);
      c.lineTo(cx + w * 0.34, bottom - h * 0.52);
      c.lineTo(cx + w * 0.42, bottom);
      c.closePath(); c.fill();
      c.strokeStyle = dim([120, 60, 50], 1.1);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx - w * 0.2, bottom - h * 0.44);
      c.lineTo(cx + w * 0.18, bottom - h * 0.36);
      c.stroke();
      return;
    }

    if (kind === 'trap') {
      c.strokeStyle = dim([168, 62, 52], 1.2);
      c.lineWidth = Math.max(1, h * 0.6);
      c.beginPath();
      c.moveTo(cx - w * 0.45, bottom);
      c.lineTo(cx + w * 0.45, bottom);
      c.stroke();
    }
  }

  drawMinimap() {
    const known = this.mapKnown || this.revealTurns > 0;
    const c = this.mmCtx, S = this.mm.width;
    const cell = S / this.size;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(0,0,0,.75)';
    c.fillRect(0, 0, S, S);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.seen[y][x] && !known) continue;
        c.fillStyle = this.grid[y][x] === 1 ? 'rgba(217,210,194,.30)' : 'rgba(217,210,194,.07)';
        c.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    if (known && this.s.mapTraps) {
      c.fillStyle = 'rgba(200,70,60,.75)';
      for (const t of this.traps) if (!t.sprung) c.fillRect(t.x * cell, t.y * cell, Math.ceil(cell), Math.ceil(cell));
    }
    if (known && this.s.mapMonsters) {
      c.fillStyle = '#e04a3c';
      for (const m of this.monsters) if (m.alive) { c.beginPath(); c.arc(m.x * cell, m.y * cell, Math.max(1.5, cell * 0.3), 0, TAU); c.fill(); }
    }

    if (this.w.exit && (known || this.seen[this.w.exit.y][this.w.exit.x])) {
      c.fillStyle = '#c8a040';
      c.fillRect(this.w.exit.x * cell, this.w.exit.y * cell, Math.ceil(cell), Math.ceil(cell));
    }

    // 플레이어와 시선
    c.fillStyle = '#d9d2c2';
    c.beginPath(); c.arc(this.px * cell, this.py * cell, Math.max(1.8, cell * 0.28), 0, TAU); c.fill();
    c.strokeStyle = 'rgba(217,210,194,.6)'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(this.px * cell, this.py * cell);
    c.lineTo((this.px + Math.cos(this.angle) * 1.6) * cell, (this.py + Math.sin(this.angle) * 1.6) * cell);
    c.stroke();
  }
}
