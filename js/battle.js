import * as THREE from 'three';
import { loadModel, HtmlLabels, popup, blip, isAudioMuted, setAudioMuted, setAudioPaused, BALL_TYPES, EVOLVED, ballName, ballDmg, ballReaction } from './common.js';

// 실시간 전투 (원작 BALL x PIT 리듬):
// - 영웅이 전장 아래를 자유롭게 이동, 공은 자동 연사 스트림(인벤토리만큼 동시 비행)
// - 조준은 오른쪽 드래그, 이동은 왼쪽 드래그(분리된 두 입력)
// - 적은 실시간으로 아래로 행진, 아래 경계 도달/영웅 접촉 시 피해
// - 처치 시 XP 젬 드롭 → 영웅이 가까이 가면 자동 수집 → 레벨업 4장 중 하나 선택(새 공 2/강화·융합 1/패시브 1)

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
const TRAIL_LENGTH = 1.2; // world-space limit: low frame rates must not stretch a ball into a long line
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
  // 적 모델을 전투 전에 준비: 진행 중 다운로드 실패로 보스가 누락되지 않게 한다.
  await Promise.all([...new Set(Object.values(ENEMY_DEFS).map(def => def.u))].map(url => loadModel(url, { poseT: false })));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const panel = document.querySelector('#screen-battle > .panel');
  const topHud = document.querySelector('#screen-battle > .hud-top');
  const VH = () => Math.max(1, H() - (panel?.offsetHeight || 120) - 4); // 모든 화면에서 전투 영역은 HUD 위까지만
  const scr = document.getElementById('screen-battle');
  const labelsC = document.getElementById('bt-labels');

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (_) { const error = new Error('3D graphics initialization failed'); error.code = 'GRAPHICS_INIT_FAILED'; throw error; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), VH());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  scr.prepend(renderer.domElement);
  const canvas = renderer.domElement;
  let renderDirty = true;
  canvas.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  scene.fog = new THREE.Fog(0x0b0f16, 10, 26);

  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 80);
  function frameCamera() {
    camera.aspect = W() / VH();
    camera.updateProjectionMatrix();
    camera.position.set(0, 12.9, 12.2);
    camera.lookAt(0, 0, -1.7);
    camera.updateMatrixWorld(true);
  }
  const fitViewport = () => {
    renderer.setSize(W(), VH()); frameCamera(); renderDirty = true;
    fitBossBar();
    document.getElementById('bt-hint').style.bottom = ((panel?.offsetHeight || 120) + 24) + 'px';
  };
  window.addEventListener('resize', fitViewport);
  if (panel) new ResizeObserver(fitViewport).observe(panel);
  function fitBossBar() {
    const top = (topHud?.offsetHeight || 64) + 2;
    document.getElementById('bt-bossbar').style.top = top + 'px';
    scr.style.setProperty('--banner-y', Math.max(24, Math.min(VH() - 48, Math.max(top + 56, VH() * 0.32))) + 'px');
  };
  if (topHud) new ResizeObserver(fitBossBar).observe(topHud);
  fitBossBar();
  frameCamera();

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
      pts[name] = [Math.round((p.x * 0.5 + 0.5) * W()), Math.round((-p.y * 0.5 + 0.5) * VH())];
    }
    document.getElementById('state').dataset.proj = JSON.stringify({pts, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio, cw: canvas.clientWidth, ch: canvas.clientHeight});
  }
  const labels = new HtmlLabels(labelsC);
  const proj = v => {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * W(), y: (-p.y * 0.5 + 0.5) * VH() };
  };

  // ---- static set ----
  const TW = 2.2, floorTiles = [];
  for (let i = -2; i <= 2; i++) for (let j = -4; j <= 2; j++)
    floorTiles.push((await loadModel('./models/d_floor_tile_large.glb', { w: TW, x: i * TW, z: j * TW })).obj);
  // Identical static pieces share draws. Keep every source mesh transform and material.
  function addStaticBatch(objects) {
    const groups = new Map();
    for (const tile of objects) {
      doubleSide(tile); tile.updateMatrixWorld(true);
      tile.traverse(mesh => {
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const key = mesh.geometry.uuid + ':' + materials.map(m => m.uuid).join(',');
        if (!groups.has(key)) groups.set(key, { geometry: mesh.geometry, material: mesh.material, transforms: [] });
        groups.get(key).transforms.push(mesh.matrixWorld.clone());
      });
    }
    for (const group of groups.values()) {
      const batch = new THREE.InstancedMesh(group.geometry, group.material, group.transforms.length);
      group.transforms.forEach((matrix, i) => batch.setMatrixAt(i, matrix));
      batch.computeBoundingSphere(); scene.add(batch);
    }
  }
  addStaticBatch(floorTiles);
  const wallPieces = [];
  for (let z = -8.9; z <= 4; z += 2.59) {
    const lw = (await loadModel('./models/d_wall.glb', { h: 2.7, x: -3.45, z, ry: Math.PI / 2 })).obj;
    const rw = (await loadModel('./models/d_wall.glb', { h: 2.7, x: 3.45, z, ry: -Math.PI / 2 })).obj;
    wallPieces.push(lw, rw);
  }
  for (const x of [-2.6, 0, 2.6])
    wallPieces.push((await loadModel('./models/d_wall.glb', { h: 3.0, x, z: BACK - 0.5 })).obj);
  addStaticBatch(wallPieces);
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
  const heroModel = await loadModel('./models/27-Knight.glb', { s: 0.72, x: 0, z: HERO_Z, ry: Math.PI, poseT: 0.5, animate: !ctx.norender, animation: 'Idle' });
  const hero = heroModel.obj, heroMixer = heroModel.mixer;
  const heroActions = {};
  for (const name of ['Idle', 'Running_A', 'Running_Strafe_Left', 'Running_Strafe_Right', 'Walking_Backwards']) {
    const clip = heroModel.animations.find(a => a.name === name);
    if (clip && heroMixer) heroActions[name] = heroMixer.clipAction(clip);
  }
  let heroMotion = 'Idle';
  function animateHero(dt, dx, dz) {
    if (!heroMixer) return;
    // 조준을 바라보면서 이동 방향에 맞는 보행으로 전환. 이동/발사 수치는 그대로.
    hero.rotation.y = Math.PI - S.aimDir;
    let motion = 'Idle';
    if (Math.hypot(dx, dz) > 0.001) {
      const forward = dx * Math.sin(S.aimDir) - dz * Math.cos(S.aimDir);
      const side = dx * Math.cos(S.aimDir) + dz * Math.sin(S.aimDir);
      motion = Math.abs(side) > Math.abs(forward) ? (side > 0 ? 'Running_Strafe_Right' : 'Running_Strafe_Left') : (forward < 0 ? 'Walking_Backwards' : 'Running_A');
    }
    if (motion !== heroMotion && heroActions[motion]) {
      const prev = heroActions[heroMotion], next = heroActions[motion];
      next.reset().play();
      if (prev) next.crossFadeFrom(prev, 0.14, false);
      heroMotion = motion;
    }
    heroMixer.update(dt);
  }
  scene.add(hero);

  // ---- game state ----
  const S = {
    phase: 'play', wave: 0, kills: 0, gold: 0, xp: 0, level: 1,
    heroHP: ctx.heroMaxHP(), heroX: 0, heroZ: HERO_Z,
    inventory: [0, 1, 2].map(() => ({ type: 'iron', lv: 1, evolved: false })),
    dmgMul: ctx.dmgMul(), fireMul: 1, balls: [], enemies: [], gems: [], parts: [], fxQueue: [], rings: [],
    aimDir: 0, moveTarget: null, over: false, nextId: 1,
    fireTimer: 0.8, spawnTimer: 0.5, now: 0, fcount: 0,
    shots: 0, hits: 0, evolvedHits: 0, lastEvolvedDmg: 0, gemsGot: 0,
    combo: 0, comboT: -99, reactions: 0,
  };
  for (let i = 1; i < ctx.extraBalls(); i++) S.inventory.push({ type: 'iron', lv: 1, evolved: false });
  const xpNeed = () => 4 + S.level * 3;

  // ---- aim preview (항상 표시) ----
  const aimMat = new THREE.LineDashedMaterial({ color: 0xffb27a, dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.85 });
  // 최대 31점(시작점 + 12 / 0.4)을 재사용. 정지 중에는 GPU 갱신도 생략.
  const aimGeo = new THREE.BufferGeometry();
  const aimPos = new THREE.BufferAttribute(new Float32Array(32 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aimDist = new THREE.BufferAttribute(new Float32Array(32), 1).setUsage(THREE.DynamicDrawUsage);
  aimGeo.setAttribute('position', aimPos); aimGeo.setAttribute('lineDistance', aimDist);
  const aimLine = new THREE.Line(aimGeo, aimMat);
  aimLine.frustumCulled = false; // 매번 바운딩 구를 다시 만들지 않는 작은 고정 길이 선
  scene.add(aimLine);
  let aimStamp = '';
  function showAim() {
    const stamp = S.heroX + ',' + S.heroZ + ',' + S.aimDir;
    if (stamp === aimStamp) return;
    aimStamp = stamp;
    let x = S.heroX, z = S.heroZ, dx = Math.sin(S.aimDir), dz = -Math.cos(S.aimDir);
    let count = 1, len = 0, distance = 0;
    aimPos.setXYZ(0, x, 0.25, z); aimDist.setX(0, 0);
    while (len < 12) {
      const step = 0.4;
      let nx = x + dx * step, nz = z + dz * step;
      if (nx < -AX + BALL_R || nx > AX - BALL_R) { dx = -dx; nx = x + dx * step; }
      if (nz < BACK + BALL_R) { dz = -dz; nz = z + dz * step; }
      // 이전 Float32BufferAttribute의 점 간 거리와 같은 대시 위상 유지
      const px = aimPos.getX(count - 1), pz = aimPos.getZ(count - 1);
      aimPos.setXYZ(count, nx, 0.25, nz);
      distance += Math.hypot(aimPos.getX(count) - px, aimPos.getZ(count) - pz);
      aimDist.setX(count, distance); count++;
      x = nx; z = nz; len += step;
    }
    aimGeo.setDrawRange(0, count);
    aimPos.needsUpdate = true; aimDist.needsUpdate = true;
  }

  // ---- enemies ----
  async function spawnEnemy(type, x, z) {
    const def = ENEMY_DEFS[type];
    const m = await loadModel(def.u, { s: def.s, x, z, clone: true, poseT: Math.random(), animate: !ctx.norender, animation: 'Walking_D_Skeletons' });
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
    const e = { id: S.nextId++, type, def, obj: m.obj, mixer: m.mixer, x, z, hp, maxHp: hp, frozen: 0, h: m.h, mats, flash: 0, label: labels.add('hp-label', '') };
    updEnemyLabel(e);
    S.enemies.push(e); renderDirty = true; // async model completion may land while a dialog holds the view
    return e;
  }
  function updEnemyLabel(e) {
    e.label.el.classList.toggle('hidden', e.type === 'boss'); // 보스 HP는 상단 전용 바에서만 표시
    e.label.el.innerHTML = `<div class="num">${Math.max(0, Math.ceil(e.hp))}</div><div class="bar"><i style="width:${Math.max(0, e.hp / e.maxHp * 100)}%"></i></div>`;
  }
  function milestone(w, boss = false) { // wave-clear reward, real gold + heal, not just UI
    const bonus = 10 + w;
    S.gold += bonus;
    const healed = S.heroHP < ctx.heroMaxHP();
    if (healed) S.heroHP++;
    if (!ctx.norender) {
      popup(labelsC, innerWidth / 2, innerHeight * 0.32, `${boss ? '보스 격파!' : '웨이브 ' + w + ' 돌파!'} +${bonus}🪙` + (healed ? ' · HP +1' : ''), 'banner');
      burst(S.heroX, S.heroZ, 0xffd76a, 18, 4.2, 0.5, { vy0: 3.5, vyR: 3, ttl0: 0.7, ttlR: 0.3, sc: 1.1 }); // gold fountain at the hero
      burst(S.heroX, S.heroZ, 0xfff6dd, 6, 2, 0.5, { vy0: 2.5, ttl0: 0.4, sc: 0.7 });
      ring(S.heroX, S.heroZ, 0xffd76a, 1.8, 0.55);
    }
    blip(880, 0.15, 'sine', 0.06);
    setTimeout(() => blip(1174, 0.18, 'sine', 0.05), 120); // two-tone clear chime
    updHud();
  }
  function delayFx(seconds, run) { S.fxQueue.push({ remaining: seconds, run }); }
  const impactRingGeo = new THREE.RingGeometry(0.62, 0.78, 40); // same silhouette shared by every short-lived ring
  function ring(x, z, color, maxR = 1.1, ttl = 0.4) { // local impact ring at the hit point
    if (ctx.norender) return;
    const m = new THREE.Mesh(impactRingGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.12, z);
    m.scale.setScalar(0.01); // 첫 프레임도 작은 반경으로 시작해 다음 프레임 수축 깜박임을 막음
    scene.add(m);
    S.rings.push({ mesh: m, t: 0, ttl, maxR });
  }
  function bounceFx(b) { // 벽 튕김: 짧은 타입색 스파크 + 작은 고리 — 적 타격(본체 플래시+피해 수치+큰 고리)과 구분
    const bc = BALL_TYPES[b.def.type].color;
    burst(b.x, b.z, bc, 5, 2.2, 0.3, { ttl0: 0.3, ttlR: 0.12, sc: 0.8 });
    ring(b.x, b.z, bc, 0.55, 0.26);
    blip(470 + Math.random() * 70, 0.03, 'square', 0.011);
  }
  function fusionFx(type, x, z) { // 융합: 타입색 이중 고리 + 좌우에서 빨려드는 수렴 섬광 + 전체 플래시
    if (ctx.norender) return;
    const col = BALL_TYPES[type].color;
    for (const sgn of [-1, 1]) for (let i = 0; i < 6; i++) { // 두 공이 하나로 모이는 수렴 파편
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(x + sgn * (1.5 + i * 0.18), 0.4, z - (i % 3) * 0.35);
      scene.add(m);
      S.parts.push({ mesh: m, vx: -sgn * 4.5, vy: 0.8, vz: 0.4 * ((i % 3) - 1), ttl: 0.42, t: 0, sc: 1.1 });
    }
    burst(x, z, col, 14, 4.5, 0.5, { vy0: 2.2, vyR: 1.5, ttl0: 0.5, ttlR: 0.2, sc: 1.2 });
    burst(x, z, 0xffe27a, 18, 5, 0.4);
    burst(x, z, 0xffffff, 8, 2.8, 0.8, { add: true });
    ring(x, z, col, 1.7, 0.55);
    delayFx(0.16, () => ring(x, z, 0xffffff, 1.15, 0.45)); // 잔상 고리
    fuseFlash.classList.remove('on'); void fuseFlash.offsetWidth; fuseFlash.classList.add('on');
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
    if (advance && w % 10 === 9 && !ctx.norender) { // 보스 전조: 다음 웨이브가 보스 웨이브
      popup(labelsC, innerWidth / 2, VH() * 0.28, '다음 웨이브: 보스', 'banner');
      blip(180, 0.3, 'sine', 0.05);
    }
    if (advance && w % 10 === 0) { // miniboss wave: single heavy hitter, gates the wave counter until killed
      await spawnEnemy('boss', 0, -6.9);
      updBossBar();
      if (!ctx.norender) {
        popup(labelsC, innerWidth / 2, innerHeight * 0.26, `미니보스 등장!`, 'banner');
        bossFlash.classList.remove('on'); void bossFlash.offsetWidth; bossFlash.classList.add('on');
        burst(0, -6.9, 0xff3b30, 24, 5.5, 0.7, { sc: 1.6, vy0: 3, vyR: 3 });
        burst(0, -6.9, 0x3a1414, 10, 3, 0.5, { sc: 1.3, ttl0: 0.9, ttlR: 0.4 }); // dark smoke shards
        ring(0, -6.9, 0xff3b30, 2.4, 0.6);
        delayFx(0.2, () => ring(0, -6.9, 0xff3b30, 1.7, 0.55)); // 연속 충격파
        delayFx(0.4, () => ring(0, -6.9, 0xff3b30, 1.1, 0.5));
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
  const gemMat = new THREE.MeshBasicMaterial({ color: 0x3fdbff, toneMapped: false, fog: false });
  const gemHaloGeo = new THREE.RingGeometry(0.22, 0.29, 20);
  const gemHaloMat = new THREE.MeshBasicMaterial({ color: 0x3fdbff, toneMapped: false, fog: false, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
  function dropGem(x, z) {
    const mesh = new THREE.Mesh(gemGeo, gemMat);
    mesh.position.set(x, 0.25, z);
    if (!ctx.norender) { const halo = new THREE.Mesh(gemHaloGeo, gemHaloMat); halo.rotation.x = -Math.PI / 2; halo.position.y = -0.08; mesh.add(halo); }
    scene.add(mesh);
    S.gems.push({ mesh, x, z, ttl: 12 });
  }

  // ---- fx: particle bursts ----
  const partGeo = new THREE.TetrahedronGeometry(0.12);
  const iceGeo = new THREE.IcosahedronGeometry(0.5, 0); // 동결 감옥(공유)
  const iceMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.34, depthWrite: false });
  function burst(x, z, color, n = 8, spd = 3, y = 0.35, o = {}) {
    if (ctx.norender) return;
    const vy0 = o.vy0 ?? 2, vyR = o.vyR ?? 2.5, ttl0 = o.ttl0 ?? 0.55, ttlR = o.ttlR ?? 0.2, sc = o.sc ?? 1;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false, transparent: true, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !o.add }));
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
    const reaction = ballReaction(src.def, e);
    if (reaction) {
      e.hp -= reaction.damage; S.reactions++;
      if (reaction.kind === 'shatter') {
        e.frozen = 0;
        if (e.iceBox) { scene.remove(e.iceBox); e.iceBox = null; }
      } else e.poison = null;
      if (!ctx.norender) {
        const p = proj(new THREE.Vector3(e.x, e.h + 0.65, e.z));
        popup(labelsC, p.x, p.y, (reaction.kind === 'shatter' ? '쇄빙' : '독 점화') + ' +' + reaction.damage);
        ring(e.x, e.z, reaction.kind === 'shatter' ? 0x9fd8ff : 0xff7a1f, 1, 0.3);
      }
    }
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
    if (reaction) updHud();
    for (const o of [...S.enemies]) if (o.hp <= 0) killEnemy(o, BALL_TYPES[src.def.type].color);
  }
  function updBossBar() { // 미니보스 전용 상단 체력바: 보스가 살아있는 동안만 표시
    const el = document.getElementById('bt-bossbar');
    if (!el) return;
    const boss = S.enemies.find(o => o.type === 'boss');
    if (!boss) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const hp = Math.max(0, Math.ceil(boss.hp));
    boss.shownHP = hp;
    el.querySelector('span').textContent = `미니보스 ${hp}/${boss.maxHp}`;
    el.setAttribute('role', 'progressbar'); el.setAttribute('aria-label', '미니보스 HP');
    el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(boss.maxHp)); el.setAttribute('aria-valuenow', String(hp));
    document.getElementById('bt-bossfill').style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  }
  function rmvEnemy(e) {
    scene.remove(e.obj);
    if (e.mixer) { e.mixer.stopAllAction(); e.mixer.uncacheRoot(e.obj); e.mixer = null; }
    if (e.iceBox) { scene.remove(e.iceBox); e.iceBox = null; }
    for (const mat of e.mats || []) mat.dispose(); // 적별 복제 재질만 해제. 공유 모델 지오메트리/텍스처는 유지
    e.mats = [];
    labels.remove(e.label);
    if (e.type === 'boss') updBossBar(); // defeat, boundary breach and hero contact all remove its HP bar
  }
  function killEnemy(e, kc = 0xffd76a) { // 처치 파편은 죽인 공 타입 색(기본 금색): 처치 주체가 색으로 읽힘
    S.enemies = S.enemies.filter(x => x !== e);
    rmvEnemy(e);
    S.kills++;
    const bsc = e.type === 'boss' ? 1.7 : 1;
    burst(e.x, e.z, kc, e.type === 'boss' ? 20 : 12, 4.5, 0.55, { sc: bsc });
    burst(e.x, e.z, 0xfff6dd, e.type === 'boss' ? 8 : 5, 2.5, 0.9, { sc: bsc });
    ring(e.x, e.z, kc, e.type === 'boss' ? 2.3 : 1.25, 0.5); // 처치 고리: 죽인 공 타입 색이 바닥으로 퍼져 처치 주체가 읽힘
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
    if (e.type === 'boss') { // 격파 클라이맥스: 연속 고리 + 검은 잔해 + 강한 흔들림 + 배너
      S.shake = Math.max(S.shake || 0, 0.25);
      if (!ctx.norender) {
        delayFx(0.15, () => ring(e.x, e.z, kc, 1.7, 0.5));
        delayFx(0.3, () => ring(e.x, e.z, 0xffffff, 1.1, 0.4));
        burst(e.x, e.z, 0x3a1414, 12, 3.4, 0.6, { sc: 1.4, ttl0: 0.9, ttlR: 0.4 });
      }
      milestone(S.wave, true); // boss gate: wave-clear reward lands when the boss actually falls
    }
    updHud();
  }

  function hurtHero(dmg, ex, ez) {
    S.heroHP -= dmg;
    S.shake = Math.max(S.shake || 0, 0.45);
    hitFlash.classList.remove('on'); void hitFlash.offsetWidth; hitFlash.classList.add('on');
    const p = proj(new THREE.Vector3(ex != null ? ex : S.heroX, 1.0, ez != null ? ez : S.heroZ));
    popup(labelsC, p.x, p.y, '-' + dmg + ' HP');
    blip(120, 0.2, 'sawtooth', 0.05, 1);
    setTimeout(() => blip(90, 0.22, 'sawtooth', 0.045, 1), 70);
    updHud();
    if (S.heroHP <= 0) gameOver();
  }

  // ---- level up / fusion ----
  document.getElementById('ov-levelup').addEventListener('keydown', e => {
    if (e.key !== 'Tab' || S.phase !== 'levelup') return;
    const buttons = [...document.querySelectorAll('#lv-cards .card-pick')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
    e.preventDefault(); buttons[next].focus(); // 네 카드 안에서 포커스를 순환
  });
  function fusiblePairs() {
    const seen = {};
    for (const b of S.inventory) {
      if (b.evolved) continue; // 진화 완료 공은 재융합해도 피해가 늘지 않으므로 후보에서 제외
      const k = b.type + ':' + b.lv + ':' + b.evolved;
      if (seen[k]) return [seen[k], b];
      seen[k] = b;
    }
    return null;
  }
  function levelUp() {
    S.phase = 'levelup'; scr.classList.add('choice-dialog-open'); clearControls(); S.level++;
    // 네 장: 서로 다른 새 공 2종 / 융합 우선 또는 강화 / 패시브
    const elements = ['fire', 'ice', 'bolt', 'poison'];
    for (let i = elements.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [elements[i], elements[j]] = [elements[j], elements[i]];
    }
    const picks = elements.slice(0, 2).map(type => ({ kind: 'new', type }));
    const passives = [{ kind: 'mul' }];
    if (S.fireMul > 0.7) passives.push({ kind: 'haste' });
    if (S.heroHP < 5) passives.push({ kind: 'life' });
    const pair = fusiblePairs();
    const basic = S.inventory.filter(b => !b.evolved);
    const owned = basic.length ? basic : S.inventory; // 진화 공만 남아도 기존 강화 공식을 써서 성장 선택 유지
    let growth;
    if (pair) growth = { kind: 'fuse', pair };
    else if (owned.length) growth = { kind: 'up', ball: owned[Math.floor(Math.random() * owned.length)] };
    else if (passives.length > 1) growth = passives.splice(1 + Math.floor(Math.random() * (passives.length - 1)), 1)[0];
    else growth = { kind: 'new', type: elements[2] }; // 강화/추가 패시브가 없으면 중복 없는 세 번째 속성
    picks.push(growth, passives[Math.floor(Math.random() * passives.length)]);
    const cards = document.getElementById('lv-cards');
    cards.innerHTML = '';
    for (const c of picks) {
      let ic, t1, t2;
      // 선택지 카드에 결과 수치를 미리 보여줘 비교 선택이 되게 (batch 17)
      if (c.kind === 'new') { ic = BALL_TYPES[c.type].css; t1 = '새 공: ' + BALL_TYPES[c.type].name; t2 = BALL_TYPES[c.type].desc + ` 기본 적중 피해 ${ballDmg({ lv: 1, evolved: false })}`; }
      else if (c.kind === 'up') { ic = BALL_TYPES[c.ball.type].css; t1 = '강화: ' + ballName(c.ball) + ' → Lv.' + (c.ball.lv + 1); t2 = `기본 적중 피해 ${ballDmg(c.ball)} → ${ballDmg({ lv: c.ball.lv + 1, evolved: c.ball.evolved })}`; }
      else if (c.kind === 'mul') { ic = '#8f7bff'; t1 = '패시브: 공격 태세'; t2 = `직격 ×${S.dmgMul.toFixed(1)} → ×${(S.dmgMul + 0.2).toFixed(1)} · 독/연쇄 피해 제외`; }
      else if (c.kind === 'haste') { ic = '#4dd2ff'; t1 = '패시브: 신속 사격'; t2 = `발사 주기 ${(FIRE_INTERVAL * S.fireMul).toFixed(2)}초 → ${(FIRE_INTERVAL * S.fireMul * 0.85).toFixed(2)}초 (최대 3회 중첩)`; }
      else if (c.kind === 'life') { ic = '#ff7a9d'; t1 = '패시브: 수호 심장'; t2 = `HP ${S.heroHP} → ${Math.min(5, S.heroHP + 1)} (최대 5)`; }
      else { const flv = c.pair[0].lv; ic = 'linear-gradient(135deg,#ff6a2a,#ffe14d)'; t1 = '융합: ' + ballName(c.pair[0]) + ' × 2 → ' + EVOLVED[c.pair[0].type].name + ' Lv.' + flv; t2 = EVOLVED[c.pair[0].type].desc + ` 기본 적중 피해 ${ballDmg({ lv: flv, evolved: true })} (기존 각 ${flv}) · 공 2개 → 1개`; }
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'card-pick';
      d.dataset.kind = c.kind;
      if (c.type) d.dataset.type = c.type;
      d.innerHTML = `<div class="ic" style="background:${ic}"></div><div><div class="t1">${t1}</div><div class="t2">${t2}</div></div>`;
      d.onclick = () => { if (S.phase !== 'levelup') return; applyCard(c); document.getElementById('ov-levelup').classList.add('hidden'); afterLevelUp(); };
      cards.appendChild(d);
    }
    document.getElementById('bt-lv').textContent = 'Lv.' + S.level;
    updHud(); // 새 레벨의 잔여 XP와 필요량을 선택 화면에도 즉시 반영
    document.getElementById('ov-levelup').classList.remove('hidden');
    cards.firstElementChild?.focus({ preventScroll: true });
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
      fusionFx(c.pair[0].type, S.heroX, S.heroZ - 0.8);
      blip(660, 0.1, 'triangle', 0.05);
      setTimeout(() => blip(990, 0.16, 'triangle', 0.05), 100);
    }
    if (c.kind !== 'fuse') blip(880, 0.12, 'triangle', 0.05);
    updHud();
  }
  function afterLevelUp() {
    if (S.xp >= xpNeed()) return levelUp();
    S.phase = 'play'; scr.classList.remove('choice-dialog-open');
  }

  document.getElementById('ov-over').addEventListener('keydown', e => {
    if (e.key === 'Tab' && S.phase === 'over') { e.preventDefault(); document.getElementById('btn-tobase').focus(); }
  });
  function gameOver() {
    if (S.over) return;
    S.over = true; S.phase = 'over'; clearControls();
    blip(200, 0.3, 'sawtooth', 0.055, 1);
    setTimeout(() => blip(130, 0.45, 'sawtooth', 0.05, 1), 170);
    document.getElementById('over-dsc').textContent = `도달 웨이브 ${S.wave} · 처치 ${S.kills} · 획득 🪙 ${S.gold}`;
    document.getElementById('ov-over').classList.remove('hidden');
    document.getElementById('btn-tobase').focus({ preventScroll: true });
    const finish = () => {
      if (S.phase === 'done') return; // 중복 클릭/자동 복귀가 원정 보상을 두 번 더하지 않게
      S.phase = 'done';
      ctx.onEnd({ gold: S.gold, wave: S.wave, kills: S.kills });
    };
    document.getElementById('btn-tobase').onclick = finish;
    if (ctx.auto) setTimeout(finish, 1500);
  }

  // ---- HUD ----
  let inventoryStamp = '';
  const inventoryRow = document.getElementById('bt-balls');
  inventoryRow.addEventListener('keydown', e => {
    const steps = { ArrowDown: 30, ArrowUp: -30, PageDown: inventoryRow.clientHeight, PageUp: -inventoryRow.clientHeight };
    if (e.key === 'Home') inventoryRow.scrollTop = 0;
    else if (e.key === 'End') inventoryRow.scrollTop = inventoryRow.scrollHeight;
    else if (e.key in steps) inventoryRow.scrollTop += steps[e.key];
    else return;
    e.preventDefault();
  });
  function updHud() {
    const bossAlive = S.enemies.some(e => e.type === 'boss');
    document.getElementById('bt-wave').textContent = '웨이브 ' + Math.max(1, S.wave) + (bossAlive ? ' · 보스' : '');
    const pb = [];
    if (S.reactions) pb.push('연계 ' + S.reactions);
    if (S.dmgMul > 1) pb.push('공격+' + Math.round((S.dmgMul - 1) * 100) + '%');
    if (S.fireMul < 1) pb.push('연사x' + Math.round(Math.log(S.fireMul) / Math.log(0.85)));
    document.getElementById('bt-info').textContent = `처치 ${S.kills} · 🪙 ${S.gold}` + (S.combo >= 2 ? ` · 연속x${S.combo}` : '') + (pb.length ? ' · ' + pb.join(' · ') : '');
    document.getElementById('bt-xp').style.width = Math.min(100, S.xp / xpNeed() * 100) + '%';
    const xpText = document.getElementById('bt-xp-text');
    if (xpText) xpText.textContent = `경험치 ${S.xp}/${xpNeed()}`;
    const xpBar = document.getElementById('bt-xp').parentElement;
    xpBar.setAttribute('aria-valuenow', String(S.xp)); xpBar.setAttribute('aria-valuemax', String(xpNeed()));
    const hp = Math.max(0, S.heroHP), hearts = document.getElementById('bt-hearts');
    hearts.textContent = hp > 5 ? `♥ ×${hp}` : ('♥'.repeat(hp) || '💀');
    hearts.style.whiteSpace = 'nowrap'; hearts.setAttribute('role', 'img'); hearts.setAttribute('aria-label', `남은 HP ${hp}`);
    const groups = new Map();
    for (const b of S.inventory) {
      const key = b.type + ':' + b.lv + ':' + !!b.evolved;
      if (groups.has(key)) groups.get(key).count++;
      else groups.set(key, { ball: b, count: 1 });
    }
    const stamp = [...groups].map(([key, g]) => key + ':' + g.count).join('|');
    if (stamp !== inventoryStamp) {
      inventoryStamp = stamp;
      const row = document.getElementById('bt-balls');
      row.setAttribute('aria-label', `보유 공 ${S.inventory.length}개`);
      row.setAttribute('role', 'group'); row.tabIndex = 0;
      row.innerHTML = [...groups.values()].map(({ ball: b, count }) =>
        `<span class="ball-chip" data-count="${count}" aria-label="${ballName(b)} ${count}개"><span class="dot" style="background:${BALL_TYPES[b.type].css}"></span>${ballName(b)}${count > 1 ? ' ×' + count : ''}</span>`).join('');
    }
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
  function clearControls() {
    const ids = [touches.move, touches.aim];
    touches.move = null; touches.aim = null; S.moveTarget = null;
    for (const id of ids) if (id != null) {
      try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) { /* 이미 해제된 포인터 */ }
    }
  }
  // Mobile interruptions must not leave a live battle running unattended.
  const pauseButton = document.createElement('button');
  pauseButton.type = 'button'; pauseButton.id = 'btn-pause'; pauseButton.textContent = 'Ⅱ';
  pauseButton.setAttribute('aria-label', '전투 일시정지');
  pauseButton.style.cssText = 'position:absolute;right:10px;top:8px;width:44px;height:44px;border:1px solid #5e6b88;border-radius:10px;background:#1b2334;color:#ece6f8;font:700 20px sans-serif;z-index:10;cursor:pointer';
  scr.appendChild(pauseButton);
  topHud.style.paddingRight = '68px';
  const pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'ov-pause'; pauseOverlay.className = 'overlay hidden';
  pauseOverlay.setAttribute('role', 'dialog'); pauseOverlay.setAttribute('aria-modal', 'true'); pauseOverlay.setAttribute('aria-labelledby', 'pause-title');
  pauseOverlay.style.boxSizing = 'border-box';
  pauseOverlay.innerHTML = '<div class="ttl" id="pause-title">일시정지</div><div class="dsc" style="text-align:center;line-height:1.8">전투 시간이 멈췄습니다.<br>준비되면 이어서 플레이하세요.</div><button class="btn" type="button">계속하기</button><button class="btn sub" id="btn-audio" type="button"></button>';
  scr.appendChild(pauseOverlay);
  const resumeButton = pauseOverlay.querySelector('button');
  const audioButton = pauseOverlay.querySelector('#btn-audio');
  function updateAudioButton() { audioButton.textContent = isAudioMuted() ? '소리 끔 · 켜기' : '소리 켜짐 · 끄기'; audioButton.setAttribute('aria-pressed', String(isAudioMuted())); }
  audioButton.onclick = () => { setAudioMuted(!isAudioMuted()); updateAudioButton(); };
  updateAudioButton();
  let pausedAnimations = [];
  let contextLost = false, contextFocus = null;
  const contextGuard = document.createElement('div');
  contextGuard.id = 'context-loss-guard'; contextGuard.className = 'overlay hidden';
  contextGuard.tabIndex = -1; contextGuard.setAttribute('role', 'alertdialog');
  contextGuard.setAttribute('aria-modal', 'true'); contextGuard.setAttribute('aria-labelledby', 'context-title');
  contextGuard.style.background = '#101019'; contextGuard.style.zIndex = '100'; contextGuard.style.padding = '24px'; contextGuard.style.boxSizing = 'border-box';
  contextGuard.innerHTML = '<div class="ttl" id="context-title">화면 복구 대기</div><div class="dsc" style="text-align:center;line-height:1.8">전투를 멈췄습니다.<br>화면이 복구되면 이어갈 수 있습니다.</div>';
  scr.appendChild(contextGuard);
  contextGuard.addEventListener('keydown', e => { if (e.key === 'Tab') e.preventDefault(); });
  function onContextLost(e) {
    e?.preventDefault(); contextLost = true; contextFocus = document.activeElement;
    pauseBattle(); clearControls(); setAudioPaused(true);
    contextGuard.classList.remove('hidden'); contextGuard.focus({ preventScroll: true });
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; renderDirty = true; contextGuard.classList.add('hidden');
    if (S.phase === 'paused') resumeButton.focus({ preventScroll: true });
    else if (contextFocus?.isConnected) contextFocus.focus({ preventScroll: true });
    setAudioPaused(S.phase === 'paused');
  });
  function pauseBattle() {
    if (S.phase !== 'play') return;
    S.phase = 'paused'; renderDirty = true; clearControls(); setAudioPaused(true);
    pausedAnimations = scr.getAnimations({ subtree: true }).filter(a => a.playState === 'running');
    for (const a of pausedAnimations) a.pause();
    pauseButton.disabled = true; pauseOverlay.classList.remove('hidden'); resumeButton.focus({ preventScroll: true });
  }
  function resumeBattle() {
    if (S.phase !== 'paused' || contextLost) return;
    pauseOverlay.classList.add('hidden'); pauseButton.disabled = false;
    for (const a of pausedAnimations) if (a.playState === 'paused') a.play();
    pausedAnimations = []; S.phase = 'play'; setAudioPaused(false); pauseButton.focus({ preventScroll: true });
  }
  pauseButton.onclick = pauseBattle; resumeButton.onclick = resumeBattle;
  // Secondary touch contacts do not synthesize click while movement is held.
  pauseButton.addEventListener('pointerup', e => { e.preventDefault(); pauseBattle(); });
  resumeButton.addEventListener('pointerup', e => { e.preventDefault(); resumeBattle(); });
  pauseOverlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    (document.activeElement === resumeButton ? audioButton : resumeButton).focus();
  });
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (S.phase === 'play') { e.preventDefault(); pauseBattle(); }
    else if (S.phase === 'paused') { e.preventDefault(); resumeBattle(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseBattle(); });
  window.addEventListener('blur', clearControls); // 화면을 벗어나면 조작 잔류 방지
  let hintGone = false;
  canvas.addEventListener('pointerdown', e => {
    if (S.phase !== 'play') return;
    if (!hintGone) { hintGone = true; document.getElementById('bt-hint')?.classList.add('hidden'); } // 첫 조작 후 안내 숨김: 영웅/필드를 가리지 않게
    const half = e.clientX < window.innerWidth / 2 ? 'move' : 'aim';
    touches[half] = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 합성 테스트에는 활성 포인터가 없을 수 있음 */ }
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
  canvas.addEventListener('lostpointercapture', release); // 캔버스 밖에서 놓거나 포인터 소유권을 잃어도 이동 상태 정리

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
    const prevHeroX = S.heroX, prevHeroZ = S.heroZ;
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
    animateHero(dt, S.heroX - prevHeroX, S.heroZ - prevHeroZ);
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
    // Delayed rings follow battle time, so choosing a card never advances them.
    const dueFx = [];
    S.fxQueue = S.fxQueue.filter(fx => { fx.remaining -= dt; if (fx.remaining > 0) return true; dueFx.push(fx); return false; });
    for (const fx of dueFx) fx.run();
    // Compact once in place: a burst can expire hundreds of materials in one frame.
    let liveParts = 0;
    for (const p of S.parts) {
      p.t += dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.position.y = Math.max(0.06, p.mesh.position.y + p.vy * dt);
      p.vy -= 9.5 * dt;
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 7;
      const k = Math.max(0, 1 - p.t / p.ttl);
      p.mesh.material.opacity = k;
      p.mesh.scale.setScalar(Math.max(0.05, k * (p.sc || 1)));
      if (p.t >= p.ttl) { scene.remove(p.mesh); p.mesh.material.dispose(); }
      else S.parts[liveParts++] = p;
    }
    S.parts.length = liveParts;
    // impact rings
    let liveRings = 0;
    for (const r of S.rings) {
      r.t += dt;
      const k = Math.max(0, 1 - r.t / r.ttl);
      r.mesh.scale.setScalar(Math.max(0.01, r.maxR * (1 - k * k))); // ease-out expand
      r.mesh.material.opacity = k * 0.9;
      if (r.t >= r.ttl) { scene.remove(r.mesh); r.mesh.material.dispose(); }
      else S.rings[liveRings++] = r;
    }
    S.rings.length = liveRings;
    // balls
    for (const b of [...S.balls]) {
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.x < -AX + BALL_R) { b.x = -AX + BALL_R; b.vx = Math.abs(b.vx); bounceFx(b); }
      if (b.x > AX - BALL_R) { b.x = AX - BALL_R; b.vx = -Math.abs(b.vx); bounceFx(b); }
      if (b.z < BACK + BALL_R) { b.z = BACK + BALL_R; b.vz = Math.abs(b.vz); bounceFx(b); }
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
        let trailLength = 0;
        for (let i = 1; i < b.trailPts.length; i++) {
          const p = b.trailPts[i - 1], q = b.trailPts[i];
          const segment = Math.hypot(q[0] - p[0], q[2] - p[2]);
          if (trailLength + segment >= TRAIL_LENGTH) {
            const k = (TRAIL_LENGTH - trailLength) / segment;
            b.trailPts[i] = [p[0] + (q[0] - p[0]) * k, 0.3, p[2] + (q[2] - p[2]) * k];
            b.trailPts.length = i + 1; break;
          }
          trailLength += segment;
        }
        const pa = b.trail.geometry.attributes.position, ca = b.trail.geometry.attributes.color, nn = b.trailPts.length;
        const cr = ((BALL_TYPES[b.def.type].color >> 16) & 255) / 255, cg = ((BALL_TYPES[b.def.type].color >> 8) & 255) / 255, cb = (BALL_TYPES[b.def.type].color & 255) / 255;
        let distance = 0;
        for (let i = 0; i < TRAIL_N; i++) {
          const q = b.trailPts[Math.min(i, nn - 1)];
          if (i > 0) { const p = b.trailPts[Math.min(i - 1, nn - 1)]; distance += Math.hypot(q[0] - p[0], q[2] - p[2]); }
          const k = Math.max(0, 1 - distance / TRAIL_LENGTH), kk = k * k;
          pa.setXYZ(i, q[0], q[1], q[2]); ca.setXYZ(i, cr * kk, cg * kk, cb * kk);
        }
        pa.needsUpdate = true; ca.needsUpdate = true;
        b.trail.geometry.setDrawRange(0, Math.max(2, nn));
      }
      if (b.z > RETURN_Z && b.vz > 0) {
        scene.remove(b.mesh); b.mesh.material.dispose(); if (b.trail) { scene.remove(b.trail); b.trail.geometry.dispose(); b.trail.material.dispose(); }
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
      if (!ctx.norender) { // 타격 반응(크기 펀치)과 상태 본체 표시: 보스 맥동과 합성해 한 번에 적용
        const punch = e.flash > 0 ? e.flash / 0.14 : 0;
        const pulse = e.type === 'boss' ? 1 + 0.06 * Math.sin(S.now * 4) : 1;
        e.obj.scale.setScalar(e.def.s * pulse * (1 + 0.14 * punch));
        if (e.frozen > 0 && !e.iceBox) { // 동결: 반투명 얼음 감옥 — '멈춤' 상태가 색만이 아니라 형태로도 읽힘
          e.iceBox = new THREE.Mesh(iceGeo, iceMat);
          e.iceBox.scale.set(e.def.s * 1.15, Math.max(e.h, 0.6) * 1.2, e.def.s * 1.15);
          scene.add(e.iceBox);
        }
        if (e.frozen <= 0 && e.iceBox) { scene.remove(e.iceBox); e.iceBox = null; }
        if (e.iceBox) { e.iceBox.position.set(e.x, Math.max(e.h, 0.6) * 0.5, e.z); e.iceBox.rotation.y += dt * 0.7; }
        if (e.poison && e.frozen <= 0) { // 중독: 몸에서 부글부글 올라가는 밝은 기포 — 녹색 틴트 위에서도 움직임으로 읽힘
          e.bubT = (e.bubT || 0) - dt;
          if (e.bubT <= 0) {
            e.bubT = 0.32;
            burst(e.x, e.z + 0.42, 0xd6ffb0, 3, 0.5, Math.max(e.h, 0.6) * 0.25, { vy0: 2.0, vyR: 0.9, ttl0: 0.7, ttlR: 0.2, sc: 1.25, add: true }); // 카메라 쪽으로 띄워 본체에 가려지지 않게
            burst(e.x, e.z + 0.42, 0x7ddc3f, 2, 0.6, Math.max(e.h, 0.6) * 0.25, { vy0: 1.7, vyR: 0.9, ttl0: 0.75, ttlR: 0.2, sc: 1.0 });
          }
        }
      }
      if (e.type === 'boss' && !ctx.norender) { // 보스 위협 고리
        e.auraT = (e.auraT || 0) - dt; if (e.auraT <= 0) { e.auraT = 0.55; ring(e.x, e.z, 0xff3b30, 1.6, 0.55); }
      }
      if (e.poison) { // 중독 지속 피해
        e.poison.t -= dt;
        e.hp -= e.poison.dps * dt;
        if (e.type === 'boss' && Math.max(0, Math.ceil(e.hp)) !== e.shownHP) updBossBar();
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
      if (e.mixer) e.mixer.update(dt * (e.type === 'boss' ? 0.4 : e.def.spd * 0.65));
      e.z += MARCH_SPEED * e.def.spd * dt;
      if (!e.warned && e.z > 1.2) { // attack telegraph: enemy about to breach
        e.warned = true;
        if (!ctx.norender) { const p = proj(new THREE.Vector3(e.x, e.h + 0.9, e.z)); popup(labelsC, p.x, p.y, '!', 'warn'); }
        blip(233, 0.12, 'square', 0.045);
      }
      e.obj.position.z = e.z;
      if (e.z >= DANGER_Z) {
        S.enemies = S.enemies.filter(x => x !== e);
        rmvEnemy(e);
        hurtHero(e.type === 'boss' ? 3 : e.type === 'warrior' ? 2 : 1, e.x, DANGER_Z);
        if (S.over) return;
        continue; // 경계에서 이미 제거/피해 처리한 적은 접촉 피해를 다시 주지 않는다.
      }
      // 영웅 접촉
      if (Math.hypot(e.x - S.heroX, e.z - S.heroZ) < 0.55) {
        S.enemies = S.enemies.filter(x => x !== e);
        rmvEnemy(e);
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
    for (const g of [...S.gems]) {
      g.ttl -= dt;
      g.mesh.rotation.y += dt * 3;
      // 시각 효과만: 수집 거리·보석 수명·경험치는 그대로 유지한다.
      g.mesh.position.y = 0.25 + Math.sin(S.now * 4 + g.x * 2) * 0.045;
      g.mesh.scale.setScalar((g.ttl < 2 ? 0.8 + Math.sin(g.ttl * 14) * 0.2 : 1) * (1 + Math.sin(S.now * 3) * 0.06));
      // Front-row drops can be beyond the hero's forward limit. Bring them
      // into the reachable lane without changing XP, lifetime or pickup radius.
      if (g.z < HERO_Z_MIN) {
        g.z = Math.min(HERO_Z_MIN, g.z + 2.4 * dt);
        g.mesh.position.z = g.z;
      }
      let d = Math.hypot(g.x - S.heroX, g.z - S.heroZ);
      if (d < 2.6 && d > 0.01) { // 자석: 가까우면 영웅에게 끌려옴
        const pull = 4.6 * dt;
        g.x += (S.heroX - g.x) / d * pull; g.z += (S.heroZ - g.z) / d * pull;
        g.mesh.position.set(g.x, 0.25, g.z);
        d = Math.hypot(g.x - S.heroX, g.z - S.heroZ);
      }
      if (d < 0.8) {
        S.xp++; S.gemsGot++;
        ring(S.heroX, S.heroZ, 0x53e0ff, 0.95, 0.32);
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
    if (contextLost || (S.phase !== 'play' && !renderDirty)) { raf(loop); return; } // pause, cards and results hold the same 3D frame
    if (S.phase === 'play') S.now += dt; // 선택/종료 화면에서는 전투 시계와 콤보를 멈춤
    if (S.phase === 'play' && S.combo > 0 && S.now - S.comboT > 4) { S.combo = 0; updHud(); }
    for (let i = 0; i < sub; i++) step(dt);
    const followX = W() / H() > 1.2 ? 0 : S.heroX * 0.6; // 세로 화면 가장자리: 부분 수평 추적으로 무기까지 프레임 안에 유지
    if (S.phase === 'play') { // pause holds the camera too, not only combat state
      if (reducedMotion.matches) { S.shake = 0; camera.position.set(followX, 12.9, 12.2); }
      else if (S.shake > 0) {
        S.shake -= dt;
        const m = S.shake * 1.5;
        camera.position.set(followX + (Math.random() - 0.5) * m, 12.9 + (Math.random() - 0.5) * m * 0.6, 12.2);
      } else { S.shake = 0; camera.position.set(followX, 12.9, 12.2); }
    }
    camera.updateMatrixWorld(true);
    if (!ctx.norender) { // 실제 전장 너비만 표시. 카메라 추적/흔들림 후 같은 좌표계로 투영
      const a = proj(new THREE.Vector3(-AX, 0.05, DANGER_Z));
      const b = proj(new THREE.Vector3(AX, 0.05, DANGER_Z));
      const left = Math.max(0, a.x), right = Math.min(W(), b.x);
      dlEl.style.left = left + 'px';
      dlEl.style.width = Math.max(0, right - left) + 'px';
      dlEl.style.top = ((a.y + b.y) * 0.5) + 'px';
    }
    if (!ctx.norender || S.fcount % 30 === 0) {
      const placed = [];
      const bossBar = document.getElementById('bt-bossbar');
      const labelTop = (bossBar.classList.contains('hidden') ? topHud.getBoundingClientRect().bottom : bossBar.getBoundingClientRect().bottom) + 4;
      // Batch size/viewport reads and projection before any position writes.
      const enemyLabels = [...S.enemies].filter(e => e.type !== 'boss').sort((a, b2) => a.x - b2.x).map(e => {
        const p = proj(new THREE.Vector3(e.x, e.h + 0.55, e.z));
        return { e, lw: e.label.el.offsetWidth || 34, lh: e.label.el.offsetHeight || 21,
          px: Math.max(20, Math.min(W() - 20, p.x)), py: Math.max(labelTop, p.y - 22) };
      });
      for (let { e, lw, lh, px, py } of enemyLabels) {
        while (placed.some(q => Math.abs(q.x - px) < (q.w + lw) / 2 + 3 && py < q.y + q.h + 3 && py + lh + 3 > q.y)) py += lh + 3;
        placed.push({ x: px, y: py, w: lw, h: lh });
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
      reactions: S.reactions, evolvedHits: S.evolvedHits, lastEvolvedDmg: S.lastEvolvedDmg, fireMul: Math.round(S.fireMul * 1000) / 1000,
      inv: S.inventory.map(b => b.type + b.lv + (b.evolved ? 'E' : '')),
    });
    if (!ctx.norender) renderer.render(scene, camera);
    renderDirty = false;
    raf(loop);
  }

  if (ctx.probe) { window.__S = S;
    window.__aimBuffer = () => ({ geometry: aimGeo.uuid, position: aimPos.uuid, count: aimGeo.drawRange.count, version: aimPos.version, points: Array.from(aimPos.array).slice(0, aimGeo.drawRange.count * 3), distances: Array.from(aimDist.array).slice(0, aimGeo.drawRange.count) });
    window.__heroMotion = () => ({ name: heroMotion, time: heroMixer?.time, rotation: hero.rotation.y, actions: Object.fromEntries(Object.entries(heroActions).map(([k, a]) => [k, { weight: a.getEffectiveWeight(), running: a.isRunning() }])) });
    window.__fx = { fusion: t => fusionFx(t || 'fire', S.heroX, S.heroZ - 0.8), bounce: () => { const b = S.balls[0]; if (b) bounceFx(b); } };
    await spawnEnemy('minion', 0, -3);
    S.aimDir = 0;
  } else { await spawnRow(true); await spawnRow(true); }
  document.getElementById('bt-loading')?.classList.add('hidden'); // assets ready: reveal the battlefield
  updHud(); showAim();
  if (document.hidden) pauseBattle(); // assets may have finished after the user left
  if (renderer.getContext().isContextLost()) onContextLost(); // context may have been lost while models were loading
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
