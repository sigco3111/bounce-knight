import * as THREE from 'three';
import { loadModel, HtmlLabels, popup, blip, BALL_TYPES, EVOLVED, ballName, ballDmg } from './common.js';

// 실시간 전투 (원작 BALL x PIT 리듬):
// - 영웅이 전장 아래를 자유롭게 이동, 공은 자동 연사 스트림(인벤토리만큼 동시 비행)
// - 조준은 오른쪽 드래그, 이동은 왼쪽 드래그(분리된 두 입력)
// - 적은 실시간으로 아래로 행진, 아래 경계 도달/영웅 접촉 시 피해
// - 처치 시 XP 젬 드롭 → 영웅이 가까이 가면 자동 수집 → 레벨업 3지선다(새 공/강화/융합)

const AX = 3.0;            // 옆벽 안쪽 면
const BACK = -7.6;         // 뒷벽 면
const HERO_Z = 3.4;        // 영웅 기본 위치
const HERO_Z_MIN = -2.6, HERO_Z_MAX = 4.2, HERO_X_MAX = 2.2;
const RETURN_Z = 4.6;      // 공 회수선
const DANGER_Z = 2.3;      // 적이 넘으면 피해
const BALL_R = 0.2;
const ENEMY_R = 0.42;
const SPEED = 10;
const FIRE_INTERVAL = 0.5;
const TRAIL_N = 12;
const SPAWN_INTERVAL = 6.5;
const MARCH_SPEED = 0.32;  // 초당 전진

const ENEMY_DEFS = {
  minion:  { u: './models/29-Skeleton_Minion.glb',  s: 0.7, hp: w => Math.round(2 + w * 0.6),  gold: 3, xp: 1, spd: 1.0 },
  rogue:   { u: './models/30-Skeleton_Rogue.glb',   s: 0.7, hp: w => Math.round(3 + w * 0.7),  gold: 4, xp: 1, spd: 1.25 },
  mage:    { u: './models/28-Skeleton_Mage.glb',    s: 0.7, hp: w => Math.round(3 + w * 0.8),  gold: 5, xp: 2, spd: 0.9 },
  warrior: { u: './models/31-Skeleton_Warrior.glb', s: 0.7, hp: w => Math.round(8 + w * 1.2),  gold: 9, xp: 2, spd: 0.65 },
  boss:    { u: './models/31-Skeleton_Warrior.glb', s: 1.15, hp: w => Math.round((8 + w * 1.2) * 3), gold: 30, xp: 6, spd: 0.45 },
};

function doubleSide(root) {
  root.traverse(o => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.side = THREE.DoubleSide; }); } });
}

export async function startBattle(ctx) {
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const scr = document.getElementById('screen-battle');
  const labelsC = document.getElementById('bt-labels');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  scr.prepend(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  scene.fog = new THREE.Fog(0x0b0f16, 10, 26);

  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 80);
  window.addEventListener('resize', () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });
  camera.position.set(0, 12.9, 12.2);
  camera.lookAt(0, 0, -1.7);
  camera.updateMatrixWorld(true);

  scene.add(new THREE.AmbientLight(0x5d6d96, 1.4));
  scene.add(new THREE.HemisphereLight(0x566a92, 0x342a20, 0.95));
  const fillR = new THREE.DirectionalLight(0xffd9b0, 0.45); fillR.position.set(-4, 6, 8); scene.add(fillR);
  const dirL = new THREE.DirectionalLight(0x9db8e8, 0.65);
  dirL.position.set(3, 9, 6); scene.add(dirL);

  if (new URLSearchParams(location.search).has('projtest')) {
    const pts = {};
    for (const [name, v] of Object.entries({
      wallL_near_bot: [-3.45, 0, 4], wallL_near_top: [-3.45, 2.7, 4], wallL_far_top: [-3.45, 2.7, -8],
      wallR_near_bot: [3.45, 0, 4], wallR_near_top: [3.45, 2.7, 4], wallR_far_top: [3.45, 2.7, -8],
      fieldL: [-3.0, 0, 0], fieldR: [3.0, 0, 0], hero: [0, 0, 3.4],
    })) {
      const p = new THREE.Vector3(...v).project(camera);
      pts[name] = [Math.round((p.x * 0.5 + 0.5) * W()), Math.round((-p.y * 0.5 + 0.5) * H())];
    }
    document.getElementById('state').dataset.proj = JSON.stringify({pts, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio, cw: canvas.clientWidth, ch: canvas.clientHeight});
  }
  const labels = new HtmlLabels(labelsC);
  const proj = v => {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * W(), y: (-p.y * 0.5 + 0.5) * H() };
  };

  // ---- static set ----
  const TW = 2.2;
  for (let i = -2; i <= 2; i++) for (let j = -4; j <= 2; j++)
    await loadModel('./models/d_floor_tile_large.glb', { w: TW, x: i * TW, z: j * TW, clone: false }).then(m => { doubleSide(m.obj); scene.add(m.obj); });
  for (let z = -8.9; z <= 4; z += 2.59) {
    const lw = (await loadModel('./models/d_wall.glb', { h: 2.7, x: -3.45, z, ry: Math.PI / 2 })).obj;
    const rw = (await loadModel('./models/d_wall.glb', { h: 2.7, x: 3.45, z, ry: -Math.PI / 2 })).obj;
    doubleSide(lw); doubleSide(rw); scene.add(lw); scene.add(rw);
  }
  for (const x of [-2.6, 0, 2.6])
    scene.add((await loadModel('./models/d_wall.glb', { h: 3.0, x, z: BACK - 0.5 })).obj);
  scene.add((await loadModel('./models/d_banner_red.glb', { h: 1.5, x: -1.3, y: 1.1, z: BACK - 0.1 })).obj);
  scene.add((await loadModel('./models/d_banner_red.glb', { h: 1.5, x: 1.3, y: 1.1, z: BACK - 0.1 })).obj);
  for (const t of [{ x: -3.2, z: -2.6 }, { x: 3.2, z: -6.2 }]) {
    scene.add((await loadModel('./models/d_torch_lit.glb', { h: 1.15, x: t.x, y: 1.15, z: t.z })).obj);
    const pl = new THREE.PointLight(0xff8c3a, 14, 8, 2);
    pl.position.set(t.x * 0.85, 1.9, t.z); scene.add(pl);
  }
  const btl = new THREE.PointLight(0xff8c3a, 20, 10, 2); btl.position.set(0, 2.1, BACK + 0.8); scene.add(btl);

  // breach boundary telegraph: DOM overlay line at DANGER_Z (3D plane is nearly edge-on to the top-down camera and invisible)
  const dlEl = document.createElement('div');
  dlEl.id = 'danger-line';
  labelsC.parentElement.appendChild(dlEl);
  const hitFlash = document.createElement('div');
  hitFlash.id = 'hit-flash';
  labelsC.parentElement.appendChild(hitFlash);
  const fuseFlash = document.createElement('div');
  fuseFlash.id = 'fuse-flash';
  labelsC.parentElement.appendChild(fuseFlash);
  const bossFlash = document.createElement('div');
  bossFlash.id = 'boss-flash';
  labelsC.parentElement.appendChild(bossFlash);
  const hero = (await loadModel('./models/27-Knight.glb', { s: 0.72, x: 0, z: HERO_Z, ry: Math.PI, poseT: 0.5 })).obj;
  scene.add(hero);

  // ---- game state ----
  const S = {
    phase: 'play', wave: 0, kills: 0, gold: 0, xp: 0, level: 1,
    heroHP: ctx.heroMaxHP(), heroX: 0, heroZ: HERO_Z,
    inventory: [0, 1, 2].map(() => ({ type: 'iron', lv: 1, evolved: false })),
    dmgMul: ctx.dmgMul(), fireMul: 1, balls: [], enemies: [], gems: [], parts: [], rings: [],
    aimDir: 0, moveTarget: null, over: false, nextId: 1,
    fireTimer: 0.8, spawnTimer: 0.5, now: 0, fcount: 0,
    shots: 0, hits: 0, evolvedHits: 0, lastEvolvedDmg: 0, gemsGot: 0,
    combo: 0, comboT: -99,
  };
  for (let i = 1; i < ctx.extraBalls(); i++) S.inventory.push({ type: 'iron', lv: 1, evolved: false });
  const xpNeed = () => 4 + S.level * 3;

  // ---- aim preview (항상 표시) ----
  const aimMat = new THREE.LineDashedMaterial({ color: 0xffb27a, dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.85 });
  let aimLine = null;
  function showAim() {
    const pts = []; let x = S.heroX, z = S.heroZ, dx = Math.sin(S.aimDir), dz = -Math.cos(S.aimDir);
    pts.push(new THREE.Vector3(x, 0.25, z));
    let len = 0;
    while (len < 12) {
      const step = 0.4;
      let nx = x + dx * step, nz = z + dz * step;
      if (nx < -AX + BALL_R || nx > AX - BALL_R) { dx = -dx; nx = x + dx * step; }
      if (nz < BACK + BALL_R) { dz = -dz; nz = z + dz * step; }
      x = nx; z = nz; len += step;
      pts.push(new THREE.Vector3(x, 0.25, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    if (aimLine) { aimLine.geometry.dispose(); aimLine.geometry = geo; }
    else { aimLine = new THREE.Line(geo, aimMat); scene.add(aimLine); }
    aimLine.computeLineDistances();
  }

  // ---- enemies ----
  async function spawnEnemy(type, x, z) {
    const def = ENEMY_DEFS[type];
    const m = await loadModel(def.u, { s: def.s, x, z, clone: true, poseT: Math.random() });
    scene.add(m.obj);
    // per-enemy cloned materials so a hit flash never bleeds onto other enemies
    const mats = [], seen = new Map();
    m.obj.traverse(o => {
      if (o.isMesh && o.material) {
        if (!seen.has(o.material.uuid)) { const c = o.material.clone(); c.userData._e = c.emissive ? c.emissive.getHex() : 0; c.userData._ei = c.emissiveIntensity != null ? c.emissiveIntensity : 1; seen.set(o.material.uuid, c); mats.push(c); }
        o.material = seen.get(o.material.uuid);
      }
    });
    const hp = def.hp(S.wave);
    const e = { id: S.nextId++, type, def, obj: m.obj, x, z, hp, maxHp: hp, frozen: 0, h: m.h, mats, flash: 0, label: labels.add('hp-label', '') };
    updEnemyLabel(e);
    S.enemies.push(e);
    return e;
  }
  function updEnemyLabel(e) {
    e.label.el.innerHTML = `<div class="num">${Math.max(0, Math.ceil(e.hp))}</div><div class="bar"><i style="width:${Math.max(0, e.hp / e.maxHp * 100)}%"></i></div>`;
  }
  function milestone(w) { // wave-clear reward, real gold + heal, not just UI
    const bonus = 10 + w;
    S.gold += bonus;
    const healed = S.heroHP < ctx.heroMaxHP();
    if (healed) S.heroHP++;
    if (!ctx.norender) {
      popup(labelsC, innerWidth / 2, innerHeight * 0.32, `웨이브 ${w} 돌파! +${bonus}🪙` + (healed ? ' · HP +1' : ''), 'banner');
      burst(S.heroX, S.heroZ, 0xffd76a, 18, 4.2, 0.5, { vy0: 3.5, vyR: 3, ttl0: 0.7, ttlR: 0.3, sc: 1.1 }); // gold fountain at the hero
      burst(S.heroX, S.heroZ, 0xfff6dd, 6, 2, 0.5, { vy0: 2.5, ttl0: 0.4, sc: 0.7 });
      ring(S.heroX, S.heroZ, 0xffd76a, 1.8, 0.55);
    }
    blip(880, 0.15, 'sine', 0.06);
    setTimeout(() => blip(1174, 0.18, 'sine', 0.05), 120); // two-tone clear chime
    updHud();
  }
  function ring(x, z, color, maxR = 1.1, ttl = 0.4) { // local impact ring at the hit point
    if (ctx.norender) return;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.12, z);
    scene.add(m);
    S.rings.push({ mesh: m, t: 0, ttl, maxR });
  }
  function typeHitBurst(def, e) { // per-type hit fx so fire/ice/bolt/iron read differently
    const y = Math.max(0.4, (e.h || 1) * 0.6), ev = !!def.evolved;
    if (def.type === 'fire') ring(e.x, e.z, 0xff7a1f, ev ? 1.5 : 1.1, 0.4);
    else if (def.type === 'ice') ring(e.x, e.z, 0x9fd8ff, ev ? 1.2 : 0.9, 0.5);
    else if (def.type === 'bolt') ring(e.x, e.z, 0xffe14d, ev ? 1.0 : 0.75, 0.24);
    else if (def.type === 'poison') ring(e.x, e.z, 0x7ddc3f, ev ? 1.3 : 1.0, 0.5);
    else ring(e.x, e.z, 0xdde7f2, ev ? 0.9 : 0.7, 0.3);
    if (def.type === 'fire') { // 폭발형: 크고 높이 솟는 화염 파편 + 잔불
      burst(e.x, e.z, 0xff7a1f, ev ? 16 : 11, ev ? 5.2 : 4.0, y, { vy0: 3, vyR: 3.5, ttl0: 0.6, ttlR: 0.3, sc: ev ? 1.5 : 1.15 });
      burst(e.x, e.z, 0xff3d00, ev ? 8 : 5, ev ? 3.2 : 2.4, y, { vy0: 1.6, vyR: 2, ttl0: 0.8, ttlR: 0.3, sc: 0.75 });
    } else if (def.type === 'ice') { // 낮게 퍼지는 냉기 파편 + 서리 안개
      burst(e.x, e.z, 0x9fd8ff, ev ? 13 : 9, ev ? 3.2 : 2.4, y, { vy0: 0.5, vyR: 0.9, ttl0: 0.75, ttlR: 0.3, sc: ev ? 1.3 : 1 });
      burst(e.x, e.z, 0xffffff, 4, 1.4, y, { vy0: 0.7, vyR: 0.5, ttl0: 0.4, ttlR: 0.15, sc: 0.65 });
    } else if (def.type === 'bolt') { // 빠르고 짧은 전기 스냅 + 백색 섬광
      burst(e.x, e.z, 0xffd400, ev ? 14 : 10, ev ? 7 : 5.5, y, { vy0: 1.2, vyR: 1.6, ttl0: 0.3, ttlR: 0.12, sc: ev ? 1.3 : 1.0 });
      burst(e.x, e.z, 0xffffff, 2, 3.2, y, { vy0: 0.8, vyR: 0.6, ttl0: 0.18, ttlR: 0.08, sc: 0.55 });
    } else if (def.type === 'poison') { // 부글부글 올라오는 독방울 + 연녹 기포
      burst(e.x, e.z, 0x7ddc3f, ev ? 13 : 9, ev ? 2.2 : 1.7, y, { vy0: 0.8, vyR: 1.1, ttl0: 0.7, ttlR: 0.3, sc: ev ? 1.25 : 1 });
      burst(e.x, e.z, 0xd6ffb0, 4, 1.2, y, { vy0: 1.4, vyR: 0.8, ttl0: 0.45, ttlR: 0.2, sc: 0.6 });
    } else { // iron: 묵직한 금속 파편
      burst(e.x, e.z, 0xdde7f2, ev ? 14 : 9, ev ? 4.8 : 3.6, y, { vy0: 2, vyR: 2.5, ttl0: 0.45, ttlR: 0.15, sc: ev ? 1.4 : 1 });
    }
  }
  async function spawnRow(advance) {
    if (advance) S.wave++;
    const w = S.wave;
    if (advance && w % 5 === 0 && w % 10 !== 0) milestone(w); // boss waves pay on boss kill instead
    if (advance && w % 10 === 0) { // miniboss wave: single heavy hitter, gates the wave counter until killed
      await spawnEnemy('boss', 0, -6.9);
      updBossBar();
      if (!ctx.norender) {
        popup(labelsC, innerWidth / 2, innerHeight * 0.26, `미니보스 등장!`, 'banner');
        bossFlash.classList.remove('on'); void bossFlash.offsetWidth; bossFlash.classList.add('on');
        burst(0, -6.9, 0xff3b30, 24, 5.5, 0.7, { sc: 1.6, vy0: 3, vyR: 3 });
        burst(0, -6.9, 0x3a1414, 10, 3, 0.5, { sc: 1.3, ttl0: 0.9, ttlR: 0.4 }); // dark smoke shards
        ring(0, -6.9, 0xff3b30, 2.4, 0.6);
      }
      S.shake = Math.max(S.shake || 0, 0.5);
      blip(196, 0.4, 'sawtooth', 0.07);
      updHud();
      return;
    }
    const count = 1 + Math.min(3, Math.floor((w - 1) / 4));
    const xs = [-2.3, -0.8, 0.8, 2.3].sort(() => Math.random() - 0.5).slice(0, count);
    for (const x of xs) {
      let type = 'minion';
      const r = Math.random();
      if (w >= 7 && r < 0.14) type = 'warrior';
      else if (w >= 5 && r < 0.4) type = 'mage';
      else if (w >= 3 && r < 0.65) type = 'rogue';
      await spawnEnemy(type, x + (Math.random() - 0.5) * 0.4, -6.9 - Math.random() * 0.5);
    }
    updHud();
  }

  // ---- gems ----
  const gemGeo = new THREE.OctahedronGeometry(0.16);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x53e0ff, emissive: 0x53e0ff, emissiveIntensity: 1.6, roughness: 0.3 });
  function dropGem(x, z) {
    const mesh = new THREE.Mesh(gemGeo, gemMat);
    mesh.position.set(x, 0.25, z);
    scene.add(mesh);
    S.gems.push({ mesh, x, z, ttl: 12 });
  }

  // ---- fx: particle bursts ----
  const partGeo = new THREE.TetrahedronGeometry(0.12);
  function burst(x, z, color, n = 8, spd = 3, y = 0.35, o = {}) {
    if (ctx.norender) return;
    const vy0 = o.vy0 ?? 2, vyR = o.vyR ?? 2.5, ttl0 = o.ttl0 ?? 0.55, ttlR = o.ttlR ?? 0.2, sc = o.sc ?? 1;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      const a = Math.random() * Math.PI * 2, s = spd * (0.5 + Math.random() * 0.8);
      m.position.set(x, y, z);
      scene.add(m);
      S.parts.push({ mesh: m, vx: Math.cos(a) * s, vy: vy0 + Math.random() * vyR, vz: Math.sin(a) * s, ttl: ttl0 + Math.random() * ttlR, t: 0, sc });
    }
  }

  // ---- balls ----
  const ballGeo = new THREE.SphereGeometry(BALL_R, 18, 18);
  function fireBall(bdef) {
    S.shots++;
    const color = BALL_TYPES[bdef.type].color;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.8, roughness: 0.3 });
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.position.set(S.heroX, 0.3, S.heroZ);
    scene.add(mesh);
    let trail = null, trailPts = [];
    if (!ctx.norender) {
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
      trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail.frustumCulled = false;
      scene.add(trail);
    }
    const a = S.aimDir;
    S.balls.push({ def: bdef, mesh, trail, trailPts, x: S.heroX, z: S.heroZ, vx: Math.sin(a) * SPEED, vz: -Math.cos(a) * SPEED, lastHit: new Map() });
    blip(520 + Math.random() * 80, 0.05, 'square', 0.02);
  }

  function damageEnemy(e, dmg, src) {
    e.hp -= dmg;
    e.flash = 0.14;
    for (const mt of e.mats || []) { if (mt.emissive) { mt.emissive.setHex(0xffffff); mt.emissiveIntensity = 0.9; } }
    if (src.def.evolved) { S.evolvedHits++; S.lastEvolvedDmg = dmg; }
    if (!ctx.norender) { const p = proj(new THREE.Vector3(e.x, e.h + 0.35, e.z)); popup(labelsC, p.x, p.y, '-' + dmg); }
    const th = { fire: [170, 'square', 0.05], ice: [560, 'sine', 0.05], bolt: [980, 'sawtooth', 0.03], iron: [220, 'square', 0.04], poison: [340, 'triangle', 0.045] }[src.def.type] || [220, 'square', 0.04];
    blip(th[0] + Math.random() * 50, th[2], th[1], 0.025); // per-type hit timbre
    typeHitBurst(src.def, e);
    if (src.def.type === 'fire') {
      const rad = src.def.evolved ? 1.4 : 0.95, sd = Math.max(1, Math.ceil(dmg / 2));
      for (const o of S.enemies) if (o !== e && Math.hypot(o.x - e.x, o.z - e.z) < rad) { o.hp -= sd; updEnemyLabel(o); }
    } else if (src.def.type === 'ice') {
      e.frozen = src.def.evolved ? 3 : 1.5;
    } else if (src.def.type === 'poison') {
      const dur = src.def.evolved ? 4 : 2.5, tot = ballDmg(src.def) * (src.def.evolved ? 2.5 : 1);
      const dps = tot / dur; // 지속 피해: 총량은 공 위력 비례, 진화 시 더 오래 더 강하게
      if (!e.poison || e.poison.dps <= dps) e.poison = { dps, t: dur, acc: 0 };
      else e.poison.t = Math.max(e.poison.t, dur);
    } else if (src.def.type === 'bolt') {
      const nChain = src.def.evolved ? 3 : 1;
      const others = S.enemies.filter(o => o !== e).sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z));
      for (const o of others.slice(0, nChain)) if (Math.hypot(o.x - e.x, o.z - e.z) < 2.2) {
        o.hp -= 1;
        o.flash = Math.max(o.flash, 0.12); // chain victims flash so the jump reads
        burst(o.x, o.z, 0xffe14d, 5, 3.2, Math.max(0.4, (o.h || 1) * 0.6), { vy0: 1.2, vyR: 1.2, ttl0: 0.26, ttlR: 0.1, sc: 0.7 });
        updEnemyLabel(o);
      }
    }
    updEnemyLabel(e);
    updBossBar();
    for (const o of [...S.enemies]) if (o.hp <= 0) killEnemy(o, BALL_TYPES[src.def.type].color);
  }
  function updBossBar() { // 미니보스 전용 상단 체력바: 보스가 살아있는 동안만 표시
    const el = document.getElementById('bt-bossbar');
    if (!el) return;
    const boss = S.enemies.find(o => o.type === 'boss');
    if (!boss) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    document.getElementById('bt-bossfill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  }
  function killEnemy(e, kc = 0xffd76a) { // 처치 파편은 죽인 공 타입 색(기본 금색): 처치 주체가 색으로 읽힘
    S.enemies = S.enemies.filter(x => x !== e);
    scene.remove(e.obj); labels.remove(e.label);
    S.kills++;
    if (e.type === 'boss') updBossBar();
    const bsc = e.type === 'boss' ? 1.7 : 1;
    burst(e.x, e.z, kc, e.type === 'boss' ? 20 : 12, 4.5, 0.55, { sc: bsc });
    burst(e.x, e.z, 0xfff6dd, e.type === 'boss' ? 8 : 5, 2.5, 0.9, { sc: bsc });
    S.shake = Math.max(S.shake || 0, 0.09);
    S.combo = (S.now - S.comboT <= 4) ? S.combo + 1 : 1; // kill streak within 4s
    S.comboT = S.now;
    if (!ctx.norender && S.combo >= 5 && S.combo % 5 === 0) {
      popup(labelsC, innerWidth / 2, innerHeight * 0.22, `x${S.combo} 연속 처치!`, 'combo');
      blip(660 + S.combo * 22, 0.16, 'triangle', 0.05);
      ring(e.x, e.z, 0xffb347, 1.4, 0.45);
    }
    const g = e.def.gold + Math.floor(S.wave / 2) + Math.floor(S.combo / 5); // combo pays real gold
    S.gold += g;
    dropGem(e.x + (Math.random() - 0.5) * 0.3, e.z);
    if (!ctx.norender) { const p = proj(new THREE.Vector3(e.x, e.h + 0.7, e.z)); popup(labelsC, p.x, p.y, '+' + g, 'gold'); }
    blip(660 * (1 + Math.min(S.combo, 20) * 0.04), 0.09, 'triangle', 0.04); // kill streak pitch rises with combo
    if (e.type === 'boss') milestone(S.wave); // boss gate: wave-clear reward lands when the boss actually falls
    updHud();
  }

  function hurtHero(dmg, ex, ez) {
    S.heroHP -= dmg;
    S.shake = Math.max(S.shake || 0, 0.45);
    hitFlash.classList.remove('on'); void hitFlash.offsetWidth; hitFlash.classList.add('on');
    const p = proj(new THREE.Vector3(ex != null ? ex : S.heroX, 1.0, ez != null ? ez : S.heroZ));
    popup(labelsC, p.x, p.y, '-' + dmg + ' HP');
    blip(120, 0.2, 'sawtooth', 0.05);
    setTimeout(() => blip(90, 0.22, 'sawtooth', 0.045), 70);
    updHud();
    if (S.heroHP <= 0) gameOver();
  }

  // ---- level up / fusion ----
  function fusiblePairs() {
    const seen = {};
    for (const b of S.inventory) {
      const k = b.type + ':' + b.lv + ':' + b.evolved;
      if (seen[k]) return [seen[k], b];
      seen[k] = b;
    }
    return null;
  }
  function levelUp() {
    S.phase = 'levelup'; S.level++;
    const pool = [];
    pool.push({ kind: 'new', type: ['fire', 'ice', 'bolt', 'poison'][Math.floor(Math.random() * 4)] });
    const owned = S.inventory.filter(b => !b.evolved);
    if (owned.length) { const b = owned[Math.floor(Math.random() * owned.length)]; pool.push({ kind: 'up', ball: b }); }
    pool.push({ kind: 'mul' });
    if (S.fireMul > 0.7) pool.push({ kind: 'haste' });
    if (S.heroHP < 5) pool.push({ kind: 'life' });
    const pair = fusiblePairs();
    if (pair) pool.push({ kind: 'fuse', pair });
    const picks = [];
    const fuseCard = pool.findIndex(c => c.kind === 'fuse');
    if (fuseCard >= 0) picks.push(pool.splice(fuseCard, 1)[0]); // 융합 가능 시 항상 제시
    while (picks.length < Math.min(3, pool.length + picks.length) && pool.length) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      picks.push(c);
    }
    const cards = document.getElementById('lv-cards');
    cards.innerHTML = '';
    for (const c of picks) {
      let ic, t1, t2;
      // 선택지 카드에 결과 수치를 미리 보여줘 비교 선택이 되게 (batch 17)
      if (c.kind === 'new') { ic = BALL_TYPES[c.type].css; t1 = '새 공: ' + BALL_TYPES[c.type].name; t2 = BALL_TYPES[c.type].desc + ` 기본 적중 피해 ${ballDmg({ lv: 1, evolved: false })}`; }
      else if (c.kind === 'up') { ic = BALL_TYPES[c.ball.type].css; t1 = '강화: ' + ballName(c.ball) + ' → Lv.' + (c.ball.lv + 1); t2 = `기본 적중 피해 ${ballDmg(c.ball)} → ${ballDmg({ lv: c.ball.lv + 1, evolved: c.ball.evolved })}`; }
      else if (c.kind === 'mul') { ic = '#8f7bff'; t1 = '패시브: 공격 태세'; t2 = `모든 공 피해량 ×${S.dmgMul.toFixed(1)} → ×${(S.dmgMul + 0.2).toFixed(1)}`; }
      else if (c.kind === 'haste') { ic = '#4dd2ff'; t1 = '패시브: 신속 사격'; t2 = `발사 주기 ${(FIRE_INTERVAL * S.fireMul).toFixed(2)}초 → ${(FIRE_INTERVAL * S.fireMul * 0.85).toFixed(2)}초 (최대 3회 중첩)`; }
      else if (c.kind === 'life') { ic = '#ff7a9d'; t1 = '패시브: 수호 심장'; t2 = `HP ${S.heroHP} → ${Math.min(5, S.heroHP + 1)} (최대 5)`; }
      else { const flv = c.pair[0].lv; ic = 'linear-gradient(135deg,#ff6a2a,#ffe14d)'; t1 = '융합: ' + ballName(c.pair[0]) + ' × 2 → ' + EVOLVED[c.pair[0].type].name + ' Lv.' + flv; t2 = EVOLVED[c.pair[0].type].desc + ` 기본 적중 피해 ${ballDmg({ lv: flv, evolved: true })} (기존 각 ${flv}) · 공 2개 → 1개`; }
      const d = document.createElement('div');
      d.className = 'card-pick';
      d.innerHTML = `<div class="ic" style="background:${ic}"></div><div><div class="t1">${t1}</div><div class="t2">${t2}</div></div>`;
      d.onclick = () => { applyCard(c); document.getElementById('ov-levelup').classList.add('hidden'); afterLevelUp(); };
      cards.appendChild(d);
    }
    document.getElementById('bt-lv').textContent = 'Lv.' + S.level;
    document.getElementById('ov-levelup').classList.remove('hidden');
    if (ctx.auto) setTimeout(() => {
      const fuse = picks.find(c => c.kind === 'fuse');
      const c = fuse || picks[Math.floor(Math.random() * picks.length)];
      applyCard(c);
      document.getElementById('ov-levelup').classList.add('hidden');
      afterLevelUp();
    }, 200);
  }
  function applyCard(c) {
    if (c.kind === 'new') S.inventory.push({ type: c.type, lv: 1, evolved: false });
    else if (c.kind === 'up') c.ball.lv++;
    else if (c.kind === 'mul') S.dmgMul += 0.2;
    else if (c.kind === 'haste') S.fireMul *= 0.85;
    else if (c.kind === 'life') S.heroHP = Math.min(5, S.heroHP + 1);
    else if (c.kind === 'fuse') {
      S.inventory = S.inventory.filter(b => b !== c.pair[0] && b !== c.pair[1]);
      const nb = { type: c.pair[0].type, lv: c.pair[0].lv, evolved: true }; // fusion keeps the pair's level: evolving always feels like an upgrade
      S.inventory.push(nb);
      if (!ctx.norender) popup(labelsC, innerWidth / 2, innerHeight * 0.3, `융합! ${ballName(nb)} 탄생`, 'banner');
      burst(S.heroX, S.heroZ - 0.8, 0xffe27a, 22, 5, 0.4);
      burst(S.heroX, S.heroZ - 0.8, 0xffffff, 8, 2.8, 0.8);
      fuseFlash.classList.remove('on'); void fuseFlash.offsetWidth; fuseFlash.classList.add('on');
      blip(660, 0.1, 'triangle', 0.05);
      setTimeout(() => blip(990, 0.16, 'triangle', 0.05), 100);
    }
    if (c.kind !== 'fuse') blip(880, 0.12, 'triangle', 0.05);
    updHud();
  }
  function afterLevelUp() {
    if (S.xp >= xpNeed()) return levelUp();
    S.phase = 'play';
  }

  function gameOver() {
    if (S.over) return;
    S.over = true; S.phase = 'over';
    blip(200, 0.3, 'sawtooth', 0.055);
    setTimeout(() => blip(130, 0.45, 'sawtooth', 0.05), 170);
    document.getElementById('over-dsc').textContent = `도달 웨이브 ${S.wave} · 처치 ${S.kills} · 획득 🪙 ${S.gold}`;
    document.getElementById('ov-over').classList.remove('hidden');
    document.getElementById('btn-tobase').onclick = () => ctx.onEnd({ gold: S.gold, wave: S.wave, kills: S.kills });
    if (ctx.auto) setTimeout(() => ctx.onEnd({ gold: S.gold, wave: S.wave, kills: S.kills }), 1500);
  }

  // ---- HUD ----
  function updHud() {
    const bossAlive = S.enemies.some(e => e.type === 'boss');
    document.getElementById('bt-wave').textContent = '웨이브 ' + Math.max(1, S.wave) + (bossAlive ? ' · 보스' : '');
    const pb = [];
    if (S.dmgMul > 1) pb.push('공격+' + Math.round((S.dmgMul - 1) * 100) + '%');
    if (S.fireMul < 1) pb.push('연사x' + Math.round(Math.log(S.fireMul) / Math.log(0.85)));
    document.getElementById('bt-info').textContent = `처치 ${S.kills} · 🪙 ${S.gold}` + (S.combo >= 2 ? ` · 연속x${S.combo}` : '') + (pb.length ? ' · ' + pb.join(' · ') : '');
    document.getElementById('bt-xp').style.width = Math.min(100, S.xp / xpNeed() * 100) + '%';
    document.getElementById('bt-hearts').textContent = '♥'.repeat(Math.max(0, S.heroHP)) || '💀';
    document.getElementById('bt-balls').innerHTML = S.inventory.map(b =>
      `<span class="ball-chip"><span class="dot" style="background:${BALL_TYPES[b.type].css}"></span>${ballName(b)}</span>`).join('');
  }
  document.getElementById('bt-hint').textContent = '왼쪽 드래그: 이동 · 오른쪽 드래그: 조준 (공은 자동 발사)';

  // ---- input: 왼쪽 절반=이동, 오른쪽 절반=조준 (멀티터치) ----
  const ray = new THREE.Raycaster();
  function groundPoint(e) {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
  }
  function aimFromPoint(p) {
    let a = Math.atan2(p.x - S.heroX, S.heroZ - p.z); // 0 = 위(-z)
    return Math.max(-1.25, Math.min(1.25, a));
  }
  const touches = { move: null, aim: null };
  canvas.addEventListener('pointerdown', e => {
    if (S.phase !== 'play') return;
    const half = e.clientX < window.innerWidth / 2 ? 'move' : 'aim';
    touches[half] = e.pointerId;
    if (half === 'move') S.moveTarget = groundPoint(e);
    else S.aimDir = aimFromPoint(groundPoint(e));
  });
  canvas.addEventListener('pointermove', e => {
    if (S.phase !== 'play') return;
    if (e.pointerId === touches.move) S.moveTarget = groundPoint(e);
    else if (e.pointerId === touches.aim) S.aimDir = aimFromPoint(groundPoint(e));
  });
  const release = e => {
    if (e.pointerId === touches.move) { touches.move = null; S.moveTarget = null; }
    if (e.pointerId === touches.aim) touches.aim = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---- auto pilot (검증 전용): 젬 추적 이동 + 최전방 적 조준, 같은 상태 경로 사용 ----
  function autoPilot() {
    if (S.phase !== 'play' || S.over) return;
    if (S.gems.length) {
      const g = [...S.gems].sort((a, c) => Math.hypot(a.x - S.heroX, a.z - S.heroZ) - Math.hypot(c.x - S.heroX, c.z - S.heroZ))[0];
      S.moveTarget = new THREE.Vector3(g.x, 0, Math.min(HERO_Z_MAX, Math.max(HERO_Z_MIN, g.z)));
    } else {
      const front = [...S.enemies].sort((a, b) => b.z - a.z)[0];
      S.moveTarget = new THREE.Vector3(front ? Math.max(-HERO_X_MAX, Math.min(HERO_X_MAX, front.x)) : 0, 0, HERO_Z);
    }
    const t = [...S.enemies].sort((a, b) => b.z - a.z)[0];
    if (t) S.aimDir = Math.max(-1.2, Math.min(1.2, Math.atan2(t.x - S.heroX, S.heroZ - t.z)));
  }

  // ---- physics & real-time sim ----
  function step(dt) {
    if (S.phase !== 'play') return;
    // hero movement
    if (S.moveTarget) {
      const dx = S.moveTarget.x - S.heroX, dz = S.moveTarget.z - S.heroZ;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) { S.moveTarget = null; }
      else {
        const sp = 5.2 * dt;
        S.heroX += dx / d * Math.min(sp, d);
        S.heroZ += dz / d * Math.min(sp, d);
        S.heroX = Math.max(-HERO_X_MAX, Math.min(HERO_X_MAX, S.heroX));
        S.heroZ = Math.max(HERO_Z_MIN, Math.min(HERO_Z_MAX, S.heroZ));
      }
    }
    hero.position.x = S.heroX; hero.position.z = S.heroZ;
    if (ctx.auto) autoPilot();
    showAim();
    // fire stream
    S.fireTimer -= dt;
    if (S.fireTimer <= 0) {
      const inFlight = new Set(S.balls.map(b => b.def));
      const loaded = S.inventory.find(b => !inFlight.has(b));
      if (loaded) { fireBall(loaded); S.fireTimer = FIRE_INTERVAL * S.fireMul; }
      else S.fireTimer = 0.12;
    }
    // fx particles
    for (const p of [...S.parts]) {
      p.t += dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.position.y = Math.max(0.06, p.mesh.position.y + p.vy * dt);
      p.vy -= 9.5 * dt;
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 7;
      const k = Math.max(0, 1 - p.t / p.ttl);
      p.mesh.material.opacity = k;
      p.mesh.scale.setScalar(Math.max(0.05, k * (p.sc || 1)));
      if (p.t >= p.ttl) { scene.remove(p.mesh); p.mesh.material.dispose(); S.parts = S.parts.filter(q => q !== p); }
    }
    // impact rings
    for (const r of [...S.rings]) {
      r.t += dt;
      const k = Math.max(0, 1 - r.t / r.ttl);
      r.mesh.scale.setScalar(Math.max(0.01, r.maxR * (1 - k * k))); // ease-out expand
      r.mesh.material.opacity = k * 0.9;
      if (r.t >= r.ttl) { scene.remove(r.mesh); r.mesh.material.dispose(); r.mesh.geometry.dispose(); S.rings = S.rings.filter(q => q !== r); }
    }
    // balls
    for (const b of [...S.balls]) {
      b.x += b.vx * dt; b.z += b.vz * dt;
      const bc = BALL_TYPES[b.def.type].color; // 튕김 스파크도 공 타입 색을 따라가게 해 소속이 읽히게
      if (b.x < -AX + BALL_R) { b.x = -AX + BALL_R; b.vx = Math.abs(b.vx); burst(b.x, b.z, bc, 3, 1.6, 0.3); blip(470 + Math.random() * 70, 0.03, 'square', 0.011); }
      if (b.x > AX - BALL_R) { b.x = AX - BALL_R; b.vx = -Math.abs(b.vx); burst(b.x, b.z, bc, 3, 1.6, 0.3); blip(470 + Math.random() * 70, 0.03, 'square', 0.011); }
      if (b.z < BACK + BALL_R) { b.z = BACK + BALL_R; b.vz = Math.abs(b.vz); burst(b.x, b.z, bc, 3, 1.6, 0.3); blip(470 + Math.random() * 70, 0.03, 'square', 0.011); }
      for (const e of S.enemies) {
        const dx = b.x - e.x, dz = b.z - e.z, d = Math.hypot(dx, dz), rs = BALL_R + ENEMY_R;
        if (d < rs) {
          const last = b.lastHit.get(e.id) || -9;
          if (S.now - last < 0.18) continue;
          b.lastHit.set(e.id, S.now);
          const nx = dx / (d || 1), nz = dz / (d || 1);
          const dot = b.vx * nx + b.vz * nz;
          b.vx -= 2 * dot * nx; b.vz -= 2 * dot * nz;
          b.x = e.x + nx * (rs + 0.01); b.z = e.z + nz * (rs + 0.01);
          S.hits++;
          const dmg = Math.max(1, Math.round(ballDmg(b.def) * S.dmgMul));
          damageEnemy(e, dmg, b);
          break;
        }
      }
      b.mesh.position.set(b.x, 0.3, b.z);
      if (b.trail) {
        b.trailPts.unshift([b.x, 0.3, b.z]);
        if (b.trailPts.length > TRAIL_N) b.trailPts.pop();
        const pa = b.trail.geometry.attributes.position, ca = b.trail.geometry.attributes.color, nn = b.trailPts.length;
        const cr = ((BALL_TYPES[b.def.type].color >> 16) & 255) / 255, cg = ((BALL_TYPES[b.def.type].color >> 8) & 255) / 255, cb = (BALL_TYPES[b.def.type].color & 255) / 255;
        for (let i = 0; i < TRAIL_N; i++) {
          const q = b.trailPts[Math.min(i, nn - 1)];
          const k = 1 - i / (TRAIL_N - 1), kk = k * k;
          pa.setXYZ(i, q[0], q[1], q[2]); ca.setXYZ(i, cr * kk, cg * kk, cb * kk);
        }
        pa.needsUpdate = true; ca.needsUpdate = true;
        b.trail.geometry.setDrawRange(0, Math.max(2, nn));
      }
      if (b.z > RETURN_Z && b.vz > 0) {
        scene.remove(b.mesh); if (b.trail) { scene.remove(b.trail); b.trail.geometry.dispose(); b.trail.material.dispose(); }
        S.balls = S.balls.filter(x => x !== b);
      }
    }
    // enemies march (real time)
    for (const e of [...S.enemies]) {
      if (e.flash > 0) {
        e.flash -= dt;
        const k = Math.max(0, e.flash / 0.14);
        for (const mt of e.mats || []) { if (mt.emissive) { mt.emissive.setHex(k > 0 ? 0xffffff : mt.userData._e); mt.emissiveIntensity = k > 0 ? 0.9 * k : mt.userData._ei; } }
      } else { // 상태 이상을 적 본체 색으로 표시: 동결=얼음빛, 중독=녹색 기운 (타격 플래시가 우선)
        const tint = e.frozen > 0 ? 0x2a6a9f : e.poison ? 0x54c22e : 0; // 중독은 어두운 장면에서도 읽히게 밝은 연두
        for (const mt of e.mats || []) { if (mt.emissive) { mt.emissive.setHex(tint || mt.userData._e); mt.emissiveIntensity = tint ? (e.poison && !e.frozen ? 0.85 : 0.6) : mt.userData._ei; } }
      }
      if (e.type === 'boss' && !ctx.norender) { // 보스 맥동+위협 고리: 살아있는 동안 위압감 표시
        e.obj.scale.setScalar(e.def.s * (1 + 0.06 * Math.sin(S.now * 4)));
        e.auraT = (e.auraT || 0) - dt; if (e.auraT <= 0) { e.auraT = 0.55; ring(e.x, e.z, 0xff3b30, 1.6, 0.55); }
      }
      if (e.poison) { // 중독 지속 피해
        e.poison.t -= dt;
        e.hp -= e.poison.dps * dt;
        e.poison.acc += e.poison.dps * dt;
        if (e.poison.acc >= 1) {
          if (!ctx.norender) { const p = proj(new THREE.Vector3(e.x, e.h + 0.35, e.z)); popup(labelsC, p.x, p.y, '-' + Math.round(e.poison.acc), 'poison'); }
          e.poison.acc = 0;
          updEnemyLabel(e);
        }
        if (e.hp <= 0) { killEnemy(e, 0x7ddc3f); continue; } // 중독사는 독 색 파편
        if (e.poison.t <= 0) e.poison = null;
      }
      if (e.frozen > 0) { e.frozen -= dt; continue; }
      e.z += MARCH_SPEED * e.def.spd * dt;
      if (!e.warned && e.z > 1.2) { // attack telegraph: enemy about to breach
        e.warned = true;
        if (!ctx.norender) { const p = proj(new THREE.Vector3(e.x, e.h + 0.9, e.z)); popup(labelsC, p.x, p.y, '!', 'warn'); }
        blip(233, 0.12, 'square', 0.045);
      }
      e.obj.position.z = e.z;
      if (e.z >= DANGER_Z) {
        S.enemies = S.enemies.filter(x => x !== e);
        scene.remove(e.obj); labels.remove(e.label);
        hurtHero(e.type === 'boss' ? 3 : e.type === 'warrior' ? 2 : 1, e.x, DANGER_Z);
        if (S.over) return;
      }
      // 영웅 접촉
      if (Math.hypot(e.x - S.heroX, e.z - S.heroZ) < 0.55) {
        S.enemies = S.enemies.filter(x => x !== e);
        scene.remove(e.obj); labels.remove(e.label);
        hurtHero(1, e.x, e.z);
        if (S.over) return;
      }
    }
    // spawn waves: time-based, but the wave counter pauses while a boss lives (boss gates progress; pressure rows keep spawning)
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      S.spawnTimer = SPAWN_INTERVAL;
      const bossAlive = S.enemies.some(e => e.type === 'boss');
      spawnRow(!bossAlive);
    }
    // gems
    if (!ctx.norender) { const dp = proj(new THREE.Vector3(0, 0.05, DANGER_Z)); dlEl.style.top = dp.y + 'px'; } // telegraph pulse
    for (const g of [...S.gems]) {
      g.ttl -= dt;
      g.mesh.rotation.y += dt * 3;
      let d = Math.hypot(g.x - S.heroX, g.z - S.heroZ);
      if (d < 2.6 && d > 0.01) { // 자석: 가까우면 영웅에게 끌려옴
        const pull = 4.6 * dt;
        g.x += (S.heroX - g.x) / d * pull; g.z += (S.heroZ - g.z) / d * pull;
        g.mesh.position.set(g.x, 0.25, g.z);
        d = Math.hypot(g.x - S.heroX, g.z - S.heroZ);
      }
      if (d < 0.8) {
        S.xp++; S.gemsGot++;
        scene.remove(g.mesh); S.gems = S.gems.filter(x => x !== g);
        blip(990, 0.06, 'sine', 0.03);
        updHud();
        if (S.xp >= xpNeed()) { S.xp -= xpNeed(); levelUp(); return; }
      } else if (g.ttl <= 0) {
        scene.remove(g.mesh); S.gems = S.gems.filter(x => x !== g);
      }
    }
  }

  // ---- main loop ----
  let last = performance.now();
  const sub = ctx.fast ? 6 : 1;
  const raf = ctx.norender ? (cb => setTimeout(() => cb(performance.now()), 16)) : requestAnimationFrame;
  function loop(t) {
    if (S.over && S.phase === 'done') return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    S.now += dt;
    if (S.combo > 0 && S.now - S.comboT > 4) { S.combo = 0; updHud(); }
    for (let i = 0; i < sub; i++) step(dt);
    if (!ctx.norender || S.fcount % 30 === 0) {
      const placed = [];
      for (const e of [...S.enemies].sort((a, b2) => a.x - b2.x)) {
        const p = proj(new THREE.Vector3(e.x, e.h + 0.55, e.z));
        let px = p.x, py = p.y - 22;
        while (placed.some(q => Math.abs(q.x - px) < 40 && Math.abs(q.y - py) < 16)) py += 16;
        placed.push({ x: px, y: py });
        labels.place(e.label, px, py);
      }
    }
    S.fcount++;
    document.getElementById('state').textContent = JSON.stringify({
      phase: S.phase, wave: S.wave, kills: S.kills, gold: S.gold, heroHP: S.heroHP, combo: S.combo,
      enemies: S.enemies.length, balls: S.balls.length, gems: S.gems.length, gemsGot: S.gemsGot,
      heroX: Math.round(S.heroX * 100) / 100, heroZ: Math.round(S.heroZ * 100) / 100,
      t: Math.round(S.now * 10) / 10, hits: S.hits, shots: S.shots,
      aim: Math.round(S.aimDir * 100) / 100,
      evolvedHits: S.evolvedHits, lastEvolvedDmg: S.lastEvolvedDmg, fireMul: Math.round(S.fireMul * 1000) / 1000,
      inv: S.inventory.map(b => b.type + b.lv + (b.evolved ? 'E' : '')),
    });
    if (S.shake > 0) {
      S.shake -= dt;
      const m = S.shake * 1.5;
      camera.position.set((Math.random() - 0.5) * m, 12.9 + (Math.random() - 0.5) * m * 0.6, 12.2);
    } else if (S.shake !== 0) { S.shake = 0; camera.position.set(0, 12.9, 12.2); }
    if (!ctx.norender) renderer.render(scene, camera);
    raf(loop);
  }

  if (ctx.probe) { window.__S = S;
    await spawnEnemy('minion', 0, -3);
    S.aimDir = 0;
  } else { await spawnRow(true); await spawnRow(true); }
  document.getElementById('bt-loading')?.classList.add('hidden'); // assets ready: reveal the battlefield
  updHud(); showAim();
  raf(loop);

  // input-path test hook: 왼쪽 드래그(이동) + 오른쪽 드래그(조준) 합성 이벤트를 실제 핸들러에 통과
  if (ctx.inputTest) {
    setTimeout(() => {
      const r = canvas.getBoundingClientRect();
      const before = { heroX: S.heroX, aim: S.aimDir };
      const opts = (x, y, id) => ({ bubbles: true, clientX: r.left + x, clientY: r.top + y, pointerId: id, pointerType: 'touch' });
      // left half: move
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts(r.width * 0.2, r.height * 0.85, 1)));
      canvas.dispatchEvent(new PointerEvent('pointermove', opts(r.width * 0.12, r.height * 0.7, 1)));
      // right half: aim
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts(r.width * 0.8, r.height * 0.8, 2)));
      canvas.dispatchEvent(new PointerEvent('pointermove', opts(r.width * 0.9, r.height * 0.3, 2)));
      setTimeout(() => {
        document.getElementById('state').dataset.inputTest = JSON.stringify({
          before, after: { heroX: Math.round(S.heroX * 100) / 100, aim: Math.round(S.aimDir * 100) / 100 },
          shots: S.shots,
        });
        canvas.dispatchEvent(new PointerEvent('pointerup', opts(r.width * 0.12, r.height * 0.7, 1)));
        canvas.dispatchEvent(new PointerEvent('pointerup', opts(r.width * 0.9, r.height * 0.3, 2)));
      }, 2500);
    }, 1500);
  }
  return S;
                                   }
