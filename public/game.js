// ─────────────────────────────────────────────────────────────
// 1인칭 레이캐스팅 엔진 (의존성 없음)
//
// 서버가 내려준 world 를 그대로 시뮬레이션한다. 방명록이 만든 규칙은
// world.state 에 들어 있고, 엔진이 모르는 규칙은 flavor 로 들어와
// 미로 안의 묘사로만 등장한다.
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

const COLORS = {
  wallLight: [58, 52, 46],
  wallDark: [38, 34, 30],
  ceil: [16, 14, 13],
  floor: [26, 23, 21],
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

    // 플레이어
    this.px = world.spawn.x;
    this.py = world.spawn.y;
    this.angle = 0;
    this.fov = 1.0; // plane 길이 ≒ 66°
    this.hp = 100;
    this.maxHp = 100;
    this.dead = false;
    this.won = false;
    this.paused = false;

    // 소지품
    this.hasPistol = false;
    this.hasKnife = false;
    this.ammo = 0;
    this.carriedCorpse = 0;
    this.weapon = 'fist';

    // 규칙에서 온 상태
    this.mapKnown = !!this.s.map;
    this.hungerLeft = this.s.hunger || 0;
    this.lostParts = [];
    this.exitAttempts = 0;

    // 월드 물체
    this.monsters = world.monsters.map((m) => ({ ...m }));
    this.corpses = world.corpses.map((c, i) => ({ id: `c${i}`, x: c.x + 0.5, y: c.y + 0.5, taken: false }));
    this.traps = world.traps.map((t, i) => ({ id: `t${i}`, x: t.x, y: t.y, sprung: false }));
    this.items = world.items.filter((it) => !it.auto).map((it) => ({ ...it, taken: false }));
    this.baits = [];

    // 안개
    this.seen = Array.from({ length: this.size }, () => Array(this.size).fill(this.mapKnown));

    this.keys = new Set();
    this.zBuf = [];
    this.shiftTimer = 0;
    this.lastT = 0;
    this.raf = 0;
    this.msgCooldown = {};

    this._bind();
    this._resize();
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
      if (!this.paused && !this.dead && !this.won) this.update(dt);
      this.render();
      this.drawMinimap();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
  }

  log(text, cls = '') { this.hooks.onLog?.(text, cls); }

  /** 같은 메시지가 도배되지 않게. */
  logOnce(key, text, cls = '', cooldown = 8000) {
    const now = performance.now();
    if (this.msgCooldown[key] && now - this.msgCooldown[key] < cooldown) return;
    this.msgCooldown[key] = now;
    this.log(text, cls);
  }

  _intro() {
    if (this.w.ruleCount === 0) {
      this.log('아무것도 없는 빈 공간이다. 저편에 문 하나가 덩그러니 서 있다.', 'sys');
    } else {
      this.log('공책에 적힌 것들이 이미 이곳에 와 있다.', 'sys');
    }
    // 방명록이 남긴, 엔진이 흉내내지 못하는 것들
    for (const f of (this.s.flavor || []).slice(-4)) {
      setTimeout(() => this.log(f, 'sys'), 900 + Math.random() * 2500);
    }
    if (this.mapKnown) this.log('지도를 손에 쥐고 있다. 미로의 구조가 전부 그려져 있다.');
    if (this.s.noPain) this.log('이상하게도 아무 두려움이 들지 않는다. 여기서는 아파지지 않는다.', 'sys');
    if (this.hungerLeft) this.log('배가 고프다. 시간이 많지 않다.', 'bad');
  }

  /* ── 입력 ─────────────────────────────────────── */
  _bind() {
    this._onKeyDown = (e) => {
      if (e.code === 'Escape') { this.togglePause(); return; }
      if (this.paused || this.dead || this.won) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyQ') this.throwBait();
      if (e.code === 'Digit1') this.selectWeapon('fist');
      if (e.code === 'Digit2' && this.hasKnife) this.selectWeapon('knife');
      if (e.code === 'Digit3' && this.hasPistol) this.selectWeapon('pistol');
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.angle += e.movementX * 0.0022;
    };
    this._onMouseDown = (e) => {
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); this.audio.resume(); return; }
      if (this.paused || this.dead || this.won) return;
      if (e.button === 0) this.attack();
      if (e.button === 2) this.throwBait();
    };
    this._onPointerLock = () => {
      if (document.pointerLockElement !== this.canvas && !this.dead && !this.won) this.setPaused(true);
    };
    this._onResize = () => this._resize();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('resize', this._onResize);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _resize() {
    const scale = 0.55; // 저해상도로 그려서 올린다. 픽셀 느낌 + 성능
    this.rw = Math.max(200, Math.floor(window.innerWidth * scale));
    this.rh = Math.max(120, Math.floor(window.innerHeight * scale));
    this.canvas.width = this.rw;
    this.canvas.height = this.rh;
    this.img = this.ctx.createImageData(this.rw, this.rh);
    const mmSize = Math.min(180, Math.max(110, Math.floor(window.innerWidth * 0.13)));
    this.mm.width = this.mm.height = mmSize;
  }

  togglePause() { if (!this.dead && !this.won) this.setPaused(!this.paused); }
  setPaused(v) {
    this.paused = v;
    this.hooks.onPause?.(v);
    if (!v) { this.canvas.requestPointerLock(); this.lastT = performance.now(); }
    else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  selectWeapon(w) { this.weapon = w; this.hooks.onHud?.(this.hudState()); }

  /* ── 갱신 ─────────────────────────────────────── */
  update(dt) {
    this.movePlayer(dt);
    this.updateMonsters(dt);
    this.updateBaits(dt);
    this.checkTraps();
    this.checkExit();

    if (this.hungerLeft > 0) {
      this.hungerLeft -= dt;
      if (this.hungerLeft <= 0) { this.hungerLeft = 0; this.die('굶어 죽었다.'); }
      else if (this.hungerLeft < 30) this.logOnce('hunger', '눈앞이 흐려진다. 배가 너무 고프다.', 'bad', 12000);
    }

    if (this.s.shifting) {
      this.shiftTimer += dt;
      if (this.shiftTimer > 15) { this.shiftTimer = 0; this.shiftMaze(); }
    }

    this.hooks.onHud?.(this.hudState());
  }

  hudState() {
    return {
      hp: Math.max(0, Math.round(this.hp)),
      maxHp: this.maxHp,
      weapon: this.weapon,
      ammo: this.ammo,
      hasPistol: this.hasPistol,
      hasKnife: this.hasKnife,
      corpse: this.carriedCorpse,
      hunger: this.hungerLeft,
      noPain: this.s.noPain,
    };
  }

  movePlayer(dt) {
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (running ? 4.2 : 2.6) * dt;
    const rot = 2.4 * dt;

    if (this.keys.has('ArrowLeft')) this.angle -= rot;
    if (this.keys.has('ArrowRight')) this.angle += rot;

    let fx = 0, fy = 0;
    const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) { fx += dx; fy += dy; }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) { fx -= dx; fy -= dy; }
    if (this.keys.has('KeyA')) { fx += dy; fy -= dx; }
    if (this.keys.has('KeyD')) { fx -= dy; fy += dx; }

    const len = Math.hypot(fx, fy);
    if (len > 0) {
      fx = (fx / len) * speed; fy = (fy / len) * speed;
      // 축을 따로 밀어서 벽에 부딪혀도 미끄러지게
      if (!this.solid(this.px + fx + Math.sign(fx) * 0.18, this.py)) this.px += fx;
      if (!this.solid(this.px, this.py + fy + Math.sign(fy) * 0.18)) this.py += fy;
    }

    const cx = Math.floor(this.px), cy = Math.floor(this.py);
    this.reveal(cx, cy);
  }

  solid(x, y) {
    const gx = Math.floor(x), gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= this.size || gy >= this.size) return true;
    return this.grid[gy][gx] === 1;
  }

  reveal(cx, cy) {
    const r = 2;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.seen[y][x] = true;
      }
    }
  }

  /* ── 괴물 ─────────────────────────────────────── */
  updateMonsters(dt) {
    const speed = 1.5 * (this.s.monsterSpeed || 1) * dt;
    let nearest = Infinity;

    for (const m of this.monsters) {
      if (!m.alive) continue;
      let tx = this.px, ty = this.py;

      // 미끼가 있으면 그쪽으로 간다
      const bait = this.nearestBait(m);
      if (bait) { tx = bait.x; ty = bait.y; }

      const d = Math.hypot(this.px - m.x, this.py - m.y);
      nearest = Math.min(nearest, d);

      const chasing = bait || (d < 9 && this.lineOfSight(m.x, m.y, this.px, this.py));
      if (chasing) {
        const a = Math.atan2(ty - m.y, tx - m.x);
        const nx = m.x + Math.cos(a) * speed;
        const ny = m.y + Math.sin(a) * speed;
        if (!this.solid(nx, m.y)) m.x = nx;
        if (!this.solid(m.x, ny)) m.y = ny;
        if (d < 7 && Math.random() < dt * 0.5) this.audio.growl();
      } else if (Math.random() < dt * 0.6) {
        // 배회
        m.wander = (m.wander ?? Math.random() * TAU) + (Math.random() - 0.5);
        const nx = m.x + Math.cos(m.wander) * speed * 0.5;
        const ny = m.y + Math.sin(m.wander) * speed * 0.5;
        if (!this.solid(nx, ny)) { m.x = nx; m.y = ny; }
      }

      // 공격
      if (!bait && d < 0.8) {
        m.cd = (m.cd ?? 0) - dt;
        if (m.cd <= 0) {
          m.cd = 1.1;
          this.damage(this.s.noPain ? 0 : 22, '괴물이 당신을 물어뜯었다.');
        }
      }
    }

    if (nearest < 4) this.logOnce('near', '숨소리가 가깝다.', 'bad', 9000);
  }

  nearestBait(m) {
    let best = null, bd = 6;
    for (const b of this.baits) {
      const d = Math.hypot(b.x - m.x, b.y - m.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  updateBaits(dt) {
    for (const b of this.baits) b.life -= dt;
    this.baits = this.baits.filter((b) => b.life > 0);
  }

  lineOfSight(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist * 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /* ── 행동 ─────────────────────────────────────── */
  attack() {
    if (this.weapon === 'pistol') {
      if (this.ammo <= 0) { this.log('탄창이 비었다.', 'bad'); return; }
      this.ammo--;
      this.audio.shot();
      const hit = this.pickTarget(18, 0.14);
      if (hit) this.hurtMonster(hit, 3);
      else this.log('총성이 복도를 타고 멀어진다.');
    } else {
      const dmg = this.weapon === 'knife' ? 2 : 1;
      const hit = this.pickTarget(1.4, 0.7);
      this.audio.blip(200, 0.07, 'square', 0.06);
      if (hit) this.hurtMonster(hit, dmg);
    }
    this.hooks.onHud?.(this.hudState());
  }

  /** 시선 안에 있는 가장 가까운 괴물. */
  pickTarget(maxDist, maxAngle) {
    let best = null, bd = maxDist;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - this.px, m.y - this.py);
      if (d > bd) continue;
      let da = Math.atan2(m.y - this.py, m.x - this.px) - this.angle;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > maxAngle) continue;
      if (!this.lineOfSight(this.px, this.py, m.x, m.y)) continue;
      bd = d; best = m;
    }
    return best;
  }

  hurtMonster(m, dmg) {
    m.hp -= dmg;
    if (m.hp <= 0) {
      m.alive = false;
      this.log('괴물이 무너져 내렸다.');
      this.audio.blip(60, 0.4, 'sawtooth', 0.1);
      if (this.monsters.every((x) => !x.alive)) this.log('더 이상 아무 소리도 들리지 않는다.', 'sys');
    } else {
      this.log('맞았다. 아직 살아 있다.', 'bad');
    }
  }

  interact() {
    // 아이템
    for (const it of this.items) {
      if (it.taken) continue;
      if (Math.hypot(it.x - this.px, it.y - this.py) < 1.0) {
        it.taken = true;
        this.audio.pickup();
        if (it.kind === 'pistol') {
          this.hasPistol = true;
          this.ammo += this.s.ammo || 12;
          this.selectWeapon('pistol');
          this.log(`권총을 주웠다. 탄약 ${this.ammo}발.`);
        } else if (it.kind === 'knife') {
          this.hasKnife = true;
          this.selectWeapon('knife');
          this.log('칼을 주웠다.');
        } else if (it.kind === 'map') {
          this.mapKnown = true;
          this.log('지도를 펼쳤다. 미로가 전부 드러났다.');
        }
        this.hooks.onHud?.(this.hudState());
        return;
      }
    }
    // 시체 — 미끼로 쓸 수 있다
    for (const c of this.corpses) {
      if (c.taken) continue;
      if (Math.hypot(c.x - this.px, c.y - this.py) < 1.0) {
        c.taken = true;
        this.carriedCorpse++;
        this.log(`비교적 멀쩡한 시체를 챙겼다. (${this.carriedCorpse}구) — Q 로 던진다.`);
        this.hooks.onHud?.(this.hudState());
        return;
      }
    }
    // 출구
    if (this.atExit()) { this.tryExit(); return; }
    this.log('아무것도 없다.');
  }

  throwBait() {
    if (this.carriedCorpse <= 0) return;
    this.carriedCorpse--;
    const bx = this.px + Math.cos(this.angle) * 2.5;
    const by = this.py + Math.sin(this.angle) * 2.5;
    this.baits.push({ x: this.solid(bx, by) ? this.px : bx, y: this.solid(bx, by) ? this.py : by, life: 14 });
    this.log('시체를 던졌다. 무언가가 그쪽으로 몰려간다.');
    this.hooks.onHud?.(this.hudState());
  }

  checkTraps() {
    const gx = Math.floor(this.px), gy = Math.floor(this.py);
    for (const t of this.traps) {
      if (t.sprung || t.x !== gx || t.y !== gy) continue;
      t.sprung = true;
      if (this.s.noPain) { this.log('무언가가 발목을 관통했다. 아무렇지도 않다.', 'sys'); }
      else this.damage(45, '함정이다. 바닥에서 솟은 것이 몸을 꿰뚫었다.');
    }
  }

  atExit() {
    if (!this.w.exit) return false;
    return Math.floor(this.px) === this.w.exit.x && Math.floor(this.py) === this.w.exit.y;
  }

  checkExit() {
    if (!this.w.exit) {
      this.logOnce('noexit', '출구가 있던 자리에 아무것도 없다.', 'bad', 20000);
      return;
    }
    if (this.atExit()) {
      if (this.s.exitCost === 'random_body_part') {
        this.hooks.onPrompt?.(this.s.exitCostKnown && this.w.demandedPart
          ? `문이 ${this.w.demandedPart}을(를) 요구한다.  [E] 두고 나간다`
          : '문이 열리지 않는다. 무언가를 두고 가야 한다.  [E] 시도한다');
      } else {
        this.hooks.onPrompt?.('[E] 문을 연다');
      }
    } else {
      this.hooks.onPrompt?.(null);
    }
  }

  tryExit() {
    if (this.s.exitCost !== 'random_body_part') { this.escape(); return; }

    this.exitAttempts++;
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
      // "장기 같은 거 나오면 그냥 죽어야되는 듯."
      const fatal = ['신장 하나', '혀', '오른쪽 눈'].includes(part);
      this.damage(fatal ? 100 : 30, `${part}을(를) 잘라 내려놓았다. 문은 열리지 않는다.`);
    }
  }

  escape() {
    if (this.won || this.dead) return;
    this.won = true;
    this.audio.door();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();

    const healed = this.s.healOnExit && this.lostParts.length > 0;
    this.hooks.onEnd?.({
      won: true,
      lostParts: this.lostParts,
      healed,
      elapsed: Date.now(),
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
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.hooks.onEnd?.({ won: false, reason, lostParts: this.lostParts });
  }

  /** "미로 구조가 계속 바뀌는" 규칙이 반영됐을 때만 돈다. */
  shiftMaze() {
    const px = Math.floor(this.px), py = Math.floor(this.py);
    const backup = this.grid.map((r) => r.slice());
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(Math.random() * (this.size - 2));
      const y = 1 + Math.floor(Math.random() * (this.size - 2));
      if ((x === px && y === py) || (this.w.exit && x === this.w.exit.x && y === this.w.exit.y)) continue;
      this.grid[y][x] = this.grid[y][x] === 1 ? 0 : 1;
    }
    // 출구까지 길이 끊기면 되돌린다
    if (this.w.exit && !this.reachable(px, py, this.w.exit.x, this.w.exit.y)) {
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
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
        if (this.grid[ny][nx] === 1 || seen.has(key)) continue;
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
      const fog = Math.max(0.08, Math.min(1, 3.2 / d));
      const r = base[0] * fog, g = base[1] * fog, b = base[2] * fog;

      for (let y = y0; y <= y1; y++) {
        const i = (y * rw + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }

    // 스프라이트
    this.renderSprites(data, dirX, dirY, planeX, planeY);

    this.ctx.putImageData(img, 0, 0);
    this.drawWeapon();
  }

  collectSprites() {
    const out = [];
    for (const m of this.monsters) if (m.alive) out.push({ x: m.x, y: m.y, color: COLORS.monster, h: 1.0, w: 0.6 });
    for (const c of this.corpses) if (!c.taken) out.push({ x: c.x, y: c.y, color: COLORS.corpse, h: 0.16, w: 0.62, ground: true });
    for (const b of this.baits) out.push({ x: b.x, y: b.y, color: COLORS.corpse, h: 0.16, w: 0.62, ground: true });
    for (const it of this.items) {
      if (it.taken) continue;
      out.push({ x: it.x, y: it.y, color: COLORS[it.kind] || COLORS.pistol, h: 0.12, w: 0.22, ground: true });
    }
    for (const t of this.traps) {
      // 함정은 지도가 있어야 보인다. 아니면 앞사람 시체로 눈치챌 수밖에.
      if (this.s.mapTraps && !t.sprung) out.push({ x: t.x + 0.5, y: t.y + 0.5, color: COLORS.trap, h: 0.1, w: 0.9, ground: true });
    }
    if (this.w.exit) out.push({ x: this.w.exit.x + 0.5, y: this.w.exit.y + 0.5, color: COLORS.exit, h: 1.3, w: 0.9, glow: true });
    return out;
  }

  renderSprites(data, dirX, dirY, planeX, planeY) {
    const { rw, rh } = this;
    const sprites = this.collectSprites()
      .map((s) => ({ ...s, d: (s.x - this.px) ** 2 + (s.y - this.py) ** 2 }))
      .sort((a, b) => b.d - a.d);

    const invDet = 1 / (planeX * dirY - dirX * planeY);

    for (const s of sprites) {
      const sx = s.x - this.px, sy = s.y - this.py;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.1) continue;

      const screenX = Math.floor((rw / 2) * (1 + tx / ty));
      const height = Math.abs(Math.floor(rh / ty)) * s.h;
      const width = Math.abs(Math.floor(rh / ty)) * s.w;

      // 바닥에 놓인 것은 아래쪽에 붙인다
      const centerY = s.ground ? rh / 2 + Math.abs(Math.floor(rh / ty)) / 2 - height / 2 : rh / 2;
      const y0 = Math.max(0, Math.floor(centerY - height / 2));
      const y1 = Math.min(rh - 1, Math.floor(centerY + height / 2));
      const x0 = Math.max(0, Math.floor(screenX - width / 2));
      const x1 = Math.min(rw - 1, Math.floor(screenX + width / 2));

      const fog = Math.max(0.12, Math.min(1, 3.6 / ty));
      const glow = s.glow ? 1 + 0.35 * Math.sin(performance.now() / 300) : 1;
      const r = Math.min(255, s.color[0] * fog * glow);
      const g = Math.min(255, s.color[1] * fog * glow);
      const b = Math.min(255, s.color[2] * fog * glow);

      const halfW = Math.max(1, width / 2);
      const halfH = height / 2;

      for (let x = x0; x <= x1; x++) {
        if (ty >= this.zBuf[x]) continue;
        // 타원으로 깎는다. 각진 사각형이 아니라 덩어리로 보이도록.
        const t = (x - screenX) / halfW;
        if (Math.abs(t) > 1) continue;
        const ext = halfH * Math.sqrt(1 - t * t);
        const ya = Math.max(y0, Math.floor(centerY - ext));
        const yb = Math.min(y1, Math.ceil(centerY + ext));
        // 위쪽을 살짝 어둡게 해서 입체감을 준다
        for (let y = ya; y <= yb; y++) {
          const v = 0.75 + 0.25 * ((y - ya) / Math.max(1, yb - ya));
          const i = (y * rw + x) * 4;
          data[i] = r * v; data[i + 1] = g * v; data[i + 2] = b * v; data[i + 3] = 255;
        }
      }
    }
  }

  /** 화면 하단의 무기. 캔버스 2D 로 간단히. */
  drawWeapon() {
    const c = this.ctx, w = this.rw, h = this.rh;
    const bob = Math.sin(performance.now() / 180) * (this.keys.size ? 3 : 1);
    c.save();
    if (this.weapon === 'pistol') {
      c.fillStyle = '#26221e';
      c.fillRect(w * 0.52, h - 42 + bob, 22, 42);
      c.fillRect(w * 0.545, h - 54 + bob, 12, 16);
    } else if (this.weapon === 'knife') {
      c.fillStyle = '#9a9aa2';
      c.beginPath();
      c.moveTo(w * 0.58, h + bob);
      c.lineTo(w * 0.62, h - 60 + bob);
      c.lineTo(w * 0.645, h - 55 + bob);
      c.lineTo(w * 0.615, h + bob);
      c.closePath(); c.fill();
    } else {
      c.fillStyle = '#5c4b42';
      c.fillRect(w * 0.56, h - 26 + bob, 34, 26);
    }
    c.restore();
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
