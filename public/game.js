// ─────────────────────────────────────────────────────────────
// 턴제 텍스트 어드벤처 엔진 + 1인칭 배경 렌더
//
// 화면은 지금 서 있는 자리에서 보이는 것을 그린다. 조작은 하지 않는다.
// 플레이어는 선택지를 고르고, 고를 때마다 한 턴이 지나간다.
// 돌아서는 것은 턴을 쓰지 않는다 — 주위를 둘러보는 데 대가를 물리면
// 아무도 둘러보지 않는다.
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

const COLORS = {
  wallLight: [96, 87, 76],
  wallDark: [62, 56, 49],
  ceil: [22, 19, 17],
  floor: [38, 34, 30],
  monster: [122, 30, 26],
  corpse: [78, 70, 58],
  pistol: [150, 145, 130],
  knife: [170, 170, 175],
  exit: [190, 160, 70],
  trap: [90, 40, 40],
};

const BODY_PARTS = [
  '머리카락 한 움큼', '왼쪽 새끼손가락', '오른쪽 검지손가락', '왼쪽 손목', '오른쪽 팔',
  '왼쪽 발목', '오른쪽 다리', '왼쪽 귀', '앞니 두 개', '오른쪽 눈', '혀', '신장 하나',
];

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
    if (!this.ctx) return;
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
  constructor(world, canvas, minimap, hooks = {}) {
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
    this.ammo = 0;
    this.carriedCorpse = 0;

    this.mapKnown = !!this.s.map;
    this.turnsLeft = this.s.hunger ? Math.max(8, Math.round(this.s.hunger / 2)) : 0;
    this.lostParts = [];

    this.monsters = world.monsters.map((m) => ({
      id: m.id, x: Math.floor(m.x), y: Math.floor(m.y), hp: 3, alive: true,
    }));
    this.corpses = world.corpses.map((c, i) => ({ id: `c${i}`, x: c.x, y: c.y, taken: false }));
    this.traps = world.traps.map((t, i) => ({ id: `t${i}`, x: t.x, y: t.y, sprung: false }));
    this.items = world.items.filter((it) => !it.auto)
      .map((it) => ({ ...it, x: Math.floor(it.x), y: Math.floor(it.y), taken: false }));
    this.baits = [];

    this.seen = Array.from({ length: this.size }, () => Array(this.size).fill(this.mapKnown));

    this.zBuf = [];
    this.raf = 0;
    this.lastT = 0;

    this._onResize = () => this._resize();
    this._onKey = (e) => this._hotkey(e);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey);

    this._resize();
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
      this.render();
      this.drawMinimap();
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
    const scale = 0.55;
    this.rw = Math.max(200, Math.floor(this.canvas.clientWidth * scale) || 400);
    this.rh = Math.max(120, Math.floor(this.canvas.clientHeight * scale) || 260);
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
    if (this.w.ruleCount === 0) {
      this.log('아무것도 없는 빈 공간이다. 저편에 문 하나가 덩그러니 서 있다.', 'sys');
    } else {
      this.log('공책에 적힌 것들이 이미 이곳에 와 있다.', 'sys');
    }
    for (const f of (this.s.flavor || []).slice(-3)) this.log(f, 'sys');
    if (this.mapKnown) this.log('지도를 손에 쥐고 있다. 미로의 구조가 전부 그려져 있다.');
    if (this.s.noPain) this.log('여기서는 아파지지 않는다. 그게 더 이상하다.', 'sys');
    if (this.turnsLeft) this.log(`배가 고프다. ${this.turnsLeft}번쯤 더 움직이면 한계다.`, 'bad');
    this.describe();
  }

  /* ── 카메라 ───────────────────────────────────── */
  stepCamera(dt) {
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
      turnsLeft: this.turnsLeft,
      noPain: this.s.noPain,
      facing: DIR_NAME[this.facing],
    };
  }

  pushState() {
    this.hooks.onHud?.(this.hudState());
    this.choices = this.buildChoices();
    this.hooks.onChoices?.(this.choices);
  }

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

  /* ── 선택지 ───────────────────────────────────── */
  buildChoices() {
    if (this.dead || this.won) return [];
    const out = [];
    const a = this.ahead();
    const blocked = this.wall(a.x, a.y);
    const sight = this.monsterInSight();

    if (this.atExit()) {
      out.push(this.s.exitCost === 'random_body_part'
        ? { id: 'exit', label: '무언가를 두고 나간다', kind: 'exit' }
        : { id: 'exit', label: '문을 연다', kind: 'exit' });
    }

    const it = this.itemHere();
    if (it) out.push({ id: 'take', label: `${ITEM_NAME[it.kind] || '무언가'}을(를) 줍는다`, kind: 'act' });
    const co = this.corpseHere();
    if (co) out.push({ id: 'corpse', label: '시체를 챙긴다', kind: 'act' });

    if (sight) {
      if (this.hasPistol && this.ammo > 0) {
        out.push({ id: 'shoot', label: `총을 쏜다`, hint: `${this.ammo}발 남음`, kind: 'fight' });
      }
      if (sight.dist === 1) {
        out.push({ id: 'melee', label: this.hasKnife ? '칼로 벤다' : '맨손으로 친다', kind: 'fight' });
      }
    }
    if (this.carriedCorpse > 0) {
      out.push({ id: 'bait', label: '시체를 던진다', hint: `${this.carriedCorpse}구`, kind: 'act' });
    }

    out.push(blocked
      ? { id: 'forward', label: '앞은 벽이다', kind: 'move', disabled: true }
      : { id: 'forward', label: '앞으로 나아간다', kind: 'move' });
    out.push({ id: 'left', label: '왼쪽으로 돈다', kind: 'turn' });
    out.push({ id: 'right', label: '오른쪽으로 돈다', kind: 'turn' });
    out.push({ id: 'back', label: '뒤돌아선다', kind: 'turn' });
    return out;
  }

  /* ── 진행 ─────────────────────────────────────── */
  choose(id) {
    if (this.busy || this.dead || this.won) return;
    const c = (this.choices || []).find((x) => x.id === id);
    if (!c || c.disabled) return;
    this.audio.resume();

    let spendsTurn = true;
    switch (id) {
      case 'left': this.facing = (this.facing + 3) % 4; spendsTurn = false; this.describe(); break;
      case 'right': this.facing = (this.facing + 1) % 4; spendsTurn = false; this.describe(); break;
      case 'back': this.facing = (this.facing + 2) % 4; spendsTurn = false; this.describe(); break;
      case 'forward': this.moveForward(); break;
      case 'take': this.takeItem(); break;
      case 'corpse': this.takeCorpse(); break;
      case 'shoot': this.shoot(); break;
      case 'melee': this.melee(); break;
      case 'bait': this.throwBait(); break;
      case 'exit': this.tryExit(); break;
      default: return;
    }

    if (this.won || this.dead) { this.pushState(); return; }
    if (spendsTurn) this.endTurn();
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
      this.ammo += this.s.ammo || 12;
      this.log(`권총을 주웠다. 탄약 ${this.ammo}발.`);
    } else if (it.kind === 'knife') {
      this.hasKnife = true;
      this.log('칼을 주웠다. 손에 익는다.');
    } else if (it.kind === 'map') {
      this.mapKnown = true;
      this.log('지도를 펼쳤다. 미로가 전부 드러났다.');
    }
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
    if (this.ammo <= 0) { this.log('탄창이 비었다.', 'bad'); return; }
    this.ammo--;
    this.audio.shot();
    if (!sight) { this.log('총성이 복도를 타고 멀어진다. 아무것도 맞지 않았다.'); return; }
    this.hurtMonster(sight.m, 3);
  }

  melee() {
    const sight = this.monsterInSight(1);
    this.audio.blip(200, 0.07, 'square', 0.06);
    if (!sight) { this.log('허공을 갈랐다.'); return; }
    this.hurtMonster(sight.m, this.hasKnife ? 2 : 1);
  }

  hurtMonster(m, dmg) {
    m.hp -= dmg;
    if (m.hp <= 0) {
      m.alive = false;
      this.audio.blip(60, 0.4, 'sawtooth', 0.1);
      this.log('그것이 무너져 내렸다.');
      if (this.monsters.every((x) => !x.alive)) this.log('더 이상 아무 소리도 들리지 않는다.', 'sys');
    } else {
      this.log('맞았다. 아직 살아 있다.', 'bad');
    }
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
    t.sprung = true;
    if (this.s.noPain) this.log('바닥에서 솟은 것이 발목을 관통했다. 아무렇지도 않다.', 'sys');
    else this.damage(45, '함정이다. 바닥에서 솟은 것이 몸을 꿰뚫었다.');
  }

  tryExit() {
    if (this.s.exitCost !== 'random_body_part') { this.escape(); return; }
    const part = BODY_PARTS[Math.floor(Math.random() * BODY_PARTS.length)];
    this.lostParts.push(part);

    if (part === this.w.demandedPart) {
      this.log(`${part}을(를) 내려놓았다. 문이 열린다.`);
      this.escape();
      return;
    }
    if (this.s.noPain) {
      this.log(`${part}을(를) 잘라 내려놓았다. 아프지 않다. 문은 그대로다.`, 'sys');
    } else {
      const fatal = ['신장 하나', '혀', '오른쪽 눈'].includes(part);
      this.damage(fatal ? 100 : 30, `${part}을(를) 잘라 내려놓았다. 문은 열리지 않는다.`);
    }
  }

  escape() {
    if (this.won || this.dead) return;
    this.won = true;
    this.audio.door();
    this.hooks.onEnd?.({
      won: true,
      lostParts: this.lostParts,
      healed: this.s.healOnExit && this.lostParts.length > 0,
      turns: this.turn,
    });
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
    this.hooks.onEnd?.({ won: false, reason, lostParts: this.lostParts });
  }

  /* ── 턴 넘기기 ─────────────────────────────────── */
  endTurn() {
    this.turn++;
    this.moveMonsters();
    if (this.dead) return;

    for (const b of this.baits) b.life--;
    this.baits = this.baits.filter((b) => b.life > 0);

    if (this.turnsLeft > 0) {
      this.turnsLeft--;
      if (this.turnsLeft === 0) { this.die('굶어 죽었다.'); return; }
      if (this.turnsLeft <= 5) this.log(`눈앞이 흐려진다. (${this.turnsLeft})`, 'bad');
    }

    if (this.s.shifting && this.turn % 8 === 0) this.shiftMaze();
  }

  moveMonsters() {
    const steps = (this.s.monsterSpeed || 1) >= 2 ? 2 : 1;
    for (let s = 0; s < steps; s++) {
      for (const m of this.monsters) {
        if (!m.alive || this.dead) continue;

        // 붙어 있으면 문다
        if (Math.abs(m.x - this.cx) + Math.abs(m.y - this.cy) === 0) {
          this.damage(this.s.noPain ? 0 : 22, '그것이 당신을 물어뜯었다.');
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
          .filter((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y))
          .sort((a, b) =>
            (Math.abs(tx - a.x) + Math.abs(ty - a.y)) - (Math.abs(tx - b.x) + Math.abs(ty - b.y)));
        if (opts.length && (Math.abs(tx - opts[0].x) + Math.abs(ty - opts[0].y)) < d) {
          m.x = opts[0].x; m.y = opts[0].y;
        }
        if (m.x === this.cx && m.y === this.cy) {
          this.damage(this.s.noPain ? 0 : 22, '그것이 당신을 덮쳤다.');
        }
      }
    }
    const near = this.monsters.filter((m) => m.alive)
      .some((m) => Math.abs(m.x - this.cx) + Math.abs(m.y - this.cy) <= 3);
    if (near) { this.audio.growl(); this.log('숨소리가 가깝다.', 'bad'); }
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

    if (this.atExit()) {
      bits.push('문이 눈앞에 있다.');
    } else if (this.wall(a.x, a.y)) {
      bits.push('앞은 막혀 있다.');
    } else {
      let n = 0;
      const [dx, dy] = DIRS[this.facing];
      while (n < 12 && !this.wall(this.cx + dx * (n + 1), this.cy + dy * (n + 1))) n++;
      bits.push(n >= 5 ? '긴 복도가 어둠 속으로 이어진다.' : `${DIR_NAME[this.facing]}쪽으로 길이 이어진다.`);
      if (this.w.exit && this.cx + dx * n === this.w.exit.x && this.cy + dy * n === this.w.exit.y) {
        bits.push('복도 끝에서 희미한 빛이 새어 나온다.');
      }
    }

    const sight = this.monsterInSight();
    if (sight) {
      bits.push(sight.dist === 1
        ? '바로 앞에 그것이 서 있다.'
        : `${sight.dist}걸음 앞에 무언가 웅크리고 있다.`);
    }

    const it = this.itemHere();
    if (it) bits.push(`발밑에 ${ITEM_NAME[it.kind] || '무언가'}이(가) 놓여 있다.`);
    if (this.corpseHere()) bits.push('바닥에 시체가 널브러져 있다.');
    if (this.traps.some((t) => !t.sprung && this.s.mapTraps && t.x === a.x && t.y === a.y)) {
      bits.push('지도에 따르면 앞 칸에 함정이 있다.');
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
      this.grid[y][x] = this.grid[y][x] === 1 ? 0 : 1;
    }
    if (this.w.exit && !this.reachable(this.cx, this.cy, this.w.exit.x, this.w.exit.y)) {
      this.grid = backup;
      return;
    }
    this.log('벽이 움직이는 소리가 난다.', 'sys');
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
  render() {
    const { rw, rh, img } = this;
    const data = img.data;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;

    // 천장 / 바닥
    for (let y = 0; y < rh; y++) {
      const top = y < rh / 2;
      const base = top ? COLORS.ceil : COLORS.floor;
      // 거리감을 주는 세로 그라데이션
      const k = top ? y / (rh / 2) : 1 - (y - rh / 2) / (rh / 2);
      const f = 0.35 + k * 0.65;
      for (let x = 0; x < rw; x++) {
        const i = (y * rw + x) * 4;
        data[i] = base[0] * f; data[i + 1] = base[1] * f; data[i + 2] = base[2] * f; data[i + 3] = 255;
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

      const lineH = Math.floor(rh / d);
      const y0 = Math.max(0, Math.floor(-lineH / 2 + rh / 2));
      const y1 = Math.min(rh - 1, Math.floor(lineH / 2 + rh / 2));

      const base = side === 1 ? COLORS.wallDark : COLORS.wallLight;
      const fog = Math.max(0.14, Math.min(1, 5.0 / d));
      const r = base[0] * fog, g = base[1] * fog, b = base[2] * fog;

      for (let y = y0; y <= y1; y++) {
        const i = (y * rw + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.drawSprites();
  }

  collectSprites() {
    const out = [];
    for (const m of this.monsters) {
      if (m.alive) out.push({ kind: 'monster', x: m.x + 0.5, y: m.y + 0.5, h: 1.05, w: 0.75 });
    }
    for (const c of this.corpses) {
      if (!c.taken) out.push({ kind: 'corpse', x: c.x + 0.5, y: c.y + 0.5, h: 0.3, w: 0.85, ground: true });
    }
    for (const b of this.baits) {
      out.push({ kind: 'corpse', x: b.x + 0.5, y: b.y + 0.5, h: 0.3, w: 0.85, ground: true });
    }
    for (const it of this.items) {
      if (it.taken) continue;
      out.push({ kind: it.kind, x: it.x + 0.5, y: it.y + 0.5, h: 0.22, w: 0.4, ground: true });
    }
    for (const t of this.traps) {
      if (this.s.mapTraps && !t.sprung) {
        out.push({ kind: 'trap', x: t.x + 0.5, y: t.y + 0.5, h: 0.06, w: 0.95, ground: true });
      }
    }
    if (this.w.exit) out.push({ kind: 'door', x: this.w.exit.x + 0.5, y: this.w.exit.y + 0.5, h: 0.92, w: 0.72 });
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

    const sprites = this.collectSprites()
      .map((s) => ({ ...s, d2: (s.x - this.px) ** 2 + (s.y - this.py) ** 2 }))
      .sort((a, b) => b.d2 - a.d2);

    for (const s of sprites) {
      const sx = s.x - this.px, sy = s.y - this.py;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.25) continue;

      const unit = Math.abs(rh / ty);
      const screenX = (rw / 2) * (1 + tx / ty);
      const w = unit * s.w;
      const h = unit * s.h;
      const floorY = rh / 2 + unit / 2;             // 이 거리에서 바닥이 닿는 높이
      const bottom = s.ground ? floorY : floorY;
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

      const fog = Math.max(0.16, Math.min(1, 5.2 / ty));

      c.save();
      c.beginPath();
      for (const [a, b] of runs) c.rect(a, 0, b - a + 1, rh);
      c.clip();
      this.paintSprite(s.kind, screenX, top, bottom, w, fog, ty);
      c.restore();
    }
  }

  paintSprite(kind, cx, top, bottom, w, fog, dist) {
    const c = this.ctx;
    const h = bottom - top;
    const dim = (rgb, k = 1) => `rgb(${rgb.map((v) => Math.round(Math.min(255, v * fog * k))).join(',')})`;

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
      c.fillStyle = dim([74, 66, 56]);
      c.beginPath();
      c.ellipse(cx, bottom - h * 0.35, w * 0.34, h * 0.5, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.ellipse(cx - w * 0.26, bottom - h * 0.2, w * 0.18, h * 0.34, 0.4, 0, TAU);
      c.fill();
      c.strokeStyle = dim([88, 78, 66]);
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
    const c = this.mmCtx, S = this.mm.width;
    const cell = S / this.size;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(0,0,0,.75)';
    c.fillRect(0, 0, S, S);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.seen[y][x] && !this.mapKnown) continue;
        c.fillStyle = this.grid[y][x] === 1 ? 'rgba(217,210,194,.30)' : 'rgba(217,210,194,.07)';
        c.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    if (this.mapKnown && this.s.mapTraps) {
      c.fillStyle = 'rgba(200,70,60,.75)';
      for (const t of this.traps) if (!t.sprung) c.fillRect(t.x * cell, t.y * cell, Math.ceil(cell), Math.ceil(cell));
    }
    if (this.mapKnown && this.s.mapMonsters) {
      c.fillStyle = '#e04a3c';
      for (const m of this.monsters) if (m.alive) { c.beginPath(); c.arc(m.x * cell, m.y * cell, Math.max(1.5, cell * 0.3), 0, TAU); c.fill(); }
    }

    if (this.w.exit && (this.mapKnown || this.seen[this.w.exit.y][this.w.exit.x])) {
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
