import { ENEMY_GUIDE, REGIONS, regionOpen, KNIGHTS, knightOpen, selectedKnight, ROUTES, selectedRoute, RELICS, CONTRACTS, selectedContract } from './content.js';
import * as THREE from 'three';
import { loadModel, HtmlLabels, nextExpeditionPlan } from './common.js';

const BLD = [
  { key: 'castleLv', name: '성', desc: lv => `영웅 최대 HP ${3 + lv - 1} → ${3 + lv}` },
  { key: 'forgeLv', name: '대장간 · 강화', desc: lv => `공 직격 피해량 +${(lv - 1) * 20}% → +${lv * 20}%` },
  { key: 'tavernLv', name: '주점 · 출격 공', desc: lv => `출격 시 기본 공 ${lv + 2}개 → ${lv + 3}개` },
];
const cost = lv => 60 * lv;

export async function startBase(ctx) {
  // ctx: { save, persist(), onSortie() }
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const scr = document.getElementById('screen-base');
  // bind the sortie CTA before any model loads: the button is visible HTML and must never be dead on slow networks
  let selectedRegion = 0;
  const regionRow = document.getElementById('region-options');
  const regionDetail = document.getElementById('region-detail');
  function chooseRegion(i) {
    if (!regionOpen(ctx.save, i)) return;
    selectedRegion = i;
    [...regionRow.children].forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
    const r = REGIONS[i];
    regionDetail.textContent = `${r.boss} · 10웨이브 · ${r.hazard}`;
    document.getElementById('base-goal').textContent = `${r.name} 10웨이브 정복${(ctx.save.clearedRegions || []).includes(r.id) ? ' · 정복 완료' : (REGIONS[i + 1] ? ' · 다음 지역 해금' : ' · 마지막 지역')}`;
    document.getElementById('btn-sortie').textContent = `${r.name} 출격 ⚔`;
  }
  regionRow.innerHTML = '';
  REGIONS.forEach((r, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = (regionOpen(ctx.save, i) ? '' : '🔒 ') + r.name;
    b.disabled = !regionOpen(ctx.save, i); b.onclick = () => chooseRegion(i); regionRow.appendChild(b);
  });
  chooseRegion(0);
  document.getElementById('btn-sortie').onclick = () => ctx.onSortie(selectedRegion);

  const knightButton = document.getElementById('btn-knight'), knightDialog = document.getElementById('ov-knights');
  const knightCards = document.getElementById('knight-cards');
  function updateKnightButton() {
    const k = selectedKnight(ctx.save); knightButton.textContent = k.short + ' 기사';
    knightButton.setAttribute('aria-label', k.name + ' 선택됨. 출격 기사 변경');
  }
  function closeKnights() { knightDialog.classList.add('hidden'); knightButton.focus(); }
  knightButton.onclick = () => {
    knightCards.innerHTML = '';
    for (const k of KNIGHTS) {
      const b = document.createElement('button'), open = knightOpen(ctx.save, k);
      b.className = 'card-pick'; b.type = 'button'; b.disabled = !open; b.dataset.knight = k.id;
      b.setAttribute('aria-pressed', String(selectedKnight(ctx.save).id === k.id));
      b.innerHTML = `<div><div class="t1">${open ? '' : '🔒 '}${k.name}${selectedKnight(ctx.save).id === k.id ? ' · 선택됨' : ''}</div><div class="t2">${k.desc}${open ? '' : '<br>' + REGIONS.find(r => r.id === k.unlock).name + ' 정복 후 해금'}</div></div>`;
      b.onclick = () => { if (!knightOpen(ctx.save, k)) return; ctx.save.selectedKnight = k.id; ctx.persist(); updateKnightButton(); closeKnights(); };
      knightCards.appendChild(b);
    }
    knightDialog.classList.remove('hidden'); knightCards.querySelector('button:not(:disabled)')?.focus();
  };
  document.getElementById('btn-knight-close').onclick = closeKnights;
  knightDialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeKnights(); }
    if (e.key !== 'Tab') return;
    const buttons = [...knightDialog.querySelectorAll('button:not(:disabled)')], i = buttons.indexOf(document.activeElement);
    e.preventDefault(); buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
  });
  updateKnightButton();

  const routeButton = document.getElementById('btn-route'), prep = document.getElementById('ov-prep');
  function updateRoute() { routeButton.textContent = '원정 준비 · ' + selectedRoute(ctx.save).name + ' · ' + selectedContract(ctx.save).name; }
  function renderPrep() {
    const routeCards = document.getElementById('route-cards'), contractCards = document.getElementById('contract-cards');
    routeCards.innerHTML = ''; contractCards.innerHTML = '';
    for (const r of ROUTES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'card-pick'; b.dataset.route = r.id;
      b.setAttribute('aria-pressed', String(selectedRoute(ctx.save).id === r.id));
      b.innerHTML = `<div><div class="t1">${r.name}</div><div class="t2">${r.desc}</div></div>`;
      b.onclick = () => { ctx.save.selectedRoute = r.id; ctx.persist(); updateRoute(); renderPrep(); prep.querySelector(`[data-route=${r.id}]`)?.focus(); }; routeCards.appendChild(b);
    }
    for (const c of CONTRACTS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'card-pick'; b.dataset.contract = c.id;
      b.setAttribute('aria-pressed', String(selectedContract(ctx.save).id === c.id));
      b.innerHTML = `<div><div class="t1">${c.name}</div><div class="t2">${c.desc}</div></div>`;
      b.onclick = () => { ctx.save.selectedContract = c.id; ctx.persist(); updateRoute(); renderPrep(); prep.querySelector(`[data-contract=${c.id}]`)?.focus(); }; contractCards.appendChild(b);
    }
    const found = ctx.save.discoveredRelics || [];
    document.getElementById('enemy-guide').textContent = ENEMY_GUIDE.map(e => `${e.name} · ${e.wave}웨이브\n${e.desc}`).join('\n\n');
    document.getElementById('codex-title').textContent = `유물 도감 ${found.length}/${RELICS.length}`;
    document.getElementById('codex-list').textContent = RELICS.map(r => found.includes(r.id) ? r.name + ': ' + r.desc : '미발견 유물').join('\n');
  }
  routeButton.onclick = () => { renderPrep(); prep.classList.remove('hidden'); prep.querySelector('button')?.focus(); };
  function closePrep() { prep.classList.add('hidden'); routeButton.focus(); }
  document.getElementById('btn-prep-close').onclick = closePrep;
  prep.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closePrep(); }
    if (e.key !== 'Tab') return;
    const buttons = [...prep.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
    e.preventDefault(); buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
  });
  updateRoute();

  const CW = () => W() / H() > 1.2 ? Math.round(W() * 0.56) : W();
  let reflowLabels = () => {};
  let needsRender = true;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (_) { const error = new Error('3D graphics initialization failed'); error.code = 'GRAPHICS_INIT_FAILED'; throw error; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(CW(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  scr.prepend(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextrestored', () => { needsRender = true; });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1c);
  scene.fog = new THREE.Fog(0x0a0f1c, 10, 26);
  const camera = new THREE.PerspectiveCamera(40, CW() / H(), 0.1, 80);
  const resize = () => { renderer.setSize(CW(), H()); camera.aspect = CW() / H(); camera.updateProjectionMatrix(); needsRender = true; reflowLabels(); };
  window.addEventListener('resize', resize);
  camera.position.set(0, 10.8, 13.6);
  camera.lookAt(0, 0, -0.4);
  camera.updateMatrixWorld(true);

  scene.add(new THREE.AmbientLight(0x3d4c6e, 1.05));
  scene.add(new THREE.HemisphereLight(0x4a5c80, 0x201812, 0.5));
  const moon = new THREE.DirectionalLight(0xa9c2ff, 0.7);
  moon.position.set(-5, 9, -4); scene.add(moon);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x0c111d, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);

  const labels = new HtmlLabels(document.getElementById('base-labels'));
  const proj = v => {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * CW(), y: (-p.y * 0.5 + 0.5) * H() };
  };

  const HEX = './models/hex_grass.gltf';
  const B = './models/';
  const NAT = './models/';
  const HW = 1.9, HD = HW * 0.866, CX = HW * 0.75;
  const tiles = [[0, 0], [CX, -HD / 2], [CX, HD / 2], [0, HD], [0, -HD], [-CX, HD / 2], [-CX, -HD / 2]];
  let tileTop = 0;
  for (const [x, z] of tiles) {
    const t = await loadModel(HEX, { w: HW, x, z });
    scene.add(t.obj);
    tileTop = Math.max(tileTop, new THREE.Box3().setFromObject(t.obj).max.y);
  }
  const spots = {
    castleLv: { pos: [0, 0], model: B + 'building_castle_blue.gltf', h: 1.7 },
    forgeLv: { pos: [-CX, -HD / 2], model: B + 'building_blacksmith_blue.gltf', h: 1.1 },
    tavernLv: { pos: [CX, -HD / 2], model: B + 'building_market_blue.gltf', h: 1.1 },
    home: { pos: [-CX, HD / 2], model: B + 'building_home_A_blue.gltf', h: 1.0, label: '민가' },
    barracks: { pos: [CX, HD / 2], model: B + 'building_barracks_blue.gltf', h: 1.05, label: '훈련소' },
  };
  const tagItems = {}, labelAnchors = {}, buildingRoots = [];
  for (const [k, sp] of Object.entries(spots)) {
    const m = await loadModel(sp.model, { h: sp.h, x: sp.pos[0], z: sp.pos[1], y: tileTop });
    scene.add(m.obj);
    if (BLD.some(b => b.key === k)) { m.obj.userData.buildingKey = k; buildingRoots.push(m.obj); }
    const name = BLD.find(b => b.key === k)?.name || sp.label;
    tagItems[k] = labels.add('tag3d', '');
    const p = proj(new THREE.Vector3(sp.pos[0], m.topY !== undefined ? 0 : 0, sp.pos[1]));
    // compute label position from building top
    const box = new THREE.Box3().setFromObject(m.obj);
    labelAnchors[k] = new THREE.Vector3(sp.pos[0], box.max.y + 0.25, sp.pos[1]);
    const pp = proj(labelAnchors[k]);
    labels.place(tagItems[k], Math.max(62, Math.min(W() - 62, pp.x)), pp.y);
    tagItems[k].el.dataset.key = k; tagItems[k].el.dataset.name = name;
  }
  scene.add((await loadModel(NAT + 'trees_A_small.gltf', { h: 1.1, x: 0, z: -HD, y: tileTop })).obj);
  scene.add((await loadModel(NAT + 'tree_single_A.gltf', { h: 1.2, x: -1.15 * CX, z: -HD * 0.95 })).obj);
  scene.add((await loadModel(NAT + 'rock_single_B.gltf', { h: 0.5, x: 1.15 * CX, z: -HD * 0.95 })).obj);
  scene.add((await loadModel('./models/27-Knight.glb', { h: 1.05, x: 1.25, z: 2.3, ry: -0.5, poseT: 0.5 })).obj);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4d1f, emissiveIntensity: 2.2, roughness: 0.35 }));
  ball.position.set(0.1, 0.3, 3.1); scene.add(ball);
  const bl = new THREE.PointLight(0xff7a30, 5, 4, 2); bl.position.copy(ball.position); scene.add(bl);
  const l1 = new THREE.PointLight(0xffb45a, 11, 6, 2); l1.position.set(0, 1.1, 0.3); scene.add(l1);
  const l2 = new THREE.PointLight(0xff7a30, 9, 5, 2); l2.position.set(-CX, 0.7, -HD / 2 + 0.25); scene.add(l2);
  const l3 = new THREE.PointLight(0xff9a4a, 6, 5, 2); l3.position.set(CX, 0.9, -HD / 2 + 0.25); scene.add(l3);

  let sel = 0;
  function selectBuilding(key) {
    const i = BLD.findIndex(b => b.key === key);
    if (i < 0) return;
    sel = i; upd(); // 선택만 변경. 업그레이드는 별도 버튼으로만 실행.
  }
  for (const [key, it] of Object.entries(tagItems)) if (BLD.some(b => b.key === key)) {
    it.el.setAttribute('role', 'button'); it.el.tabIndex = 0;
    it.el.style.pointerEvents = 'auto'; it.el.style.cursor = 'pointer';
    it.el.onclick = () => selectBuilding(key);
    it.el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBuilding(key); } };
  }
  const pickRay = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerup', e => {
    if (scr.classList.contains('hidden')) return;
    const r = renderer.domElement.getBoundingClientRect();
    pickRay.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = pickRay.intersectObjects(buildingRoots, true)[0];
    let o = hit?.object;
    while (o && !o.userData.buildingKey) o = o.parent;
    if (o) selectBuilding(o.userData.buildingKey);
  });
  reflowLabels = () => {
    const placed = [];
    for (const [key, it] of Object.entries(tagItems)) {
      const p = proj(labelAnchors[key]);
      const w = it.el.offsetWidth, h = it.el.offsetHeight;
      const x = Math.max(w / 2 + 8, Math.min(CW() - w / 2 - 8, p.x));
      let y = Math.max(208, p.y);
      while (placed.some(q => Math.abs(q.x - x) < (q.w + w) / 2 + 4 && y < q.y + q.h + 3 && y + h + 3 > q.y)) y += h + 4;
      placed.push({ x, y, w, h }); labels.place(it, x, y);
    }
  };
  function upd() {
    document.getElementById('base-gold').textContent = ctx.save.gold;
    document.getElementById('base-best').textContent = ctx.save.bestWave;
    for (const [k, it] of Object.entries(tagItems)) {
      const b = BLD.find(x => x.key === k);
      if (b) { const active = b.key === BLD[sel].key; it.el.setAttribute('aria-pressed', String(active)); it.el.style.outline = active ? '1px solid #e7ab59' : ''; }
      it.el.innerHTML = b ? `${b.name.split(' ·')[0]} <span class="lv">Lv.${ctx.save[k]}</span>` : it.el.dataset.name;
    }
    const b = BLD[sel], lv = ctx.save[b.key];
    document.getElementById('bld-name').textContent = `${b.name} Lv.${lv}`;
    document.getElementById('bld-desc').textContent = b.desc(lv);
    document.getElementById('bld-cost').textContent = '🪙 ' + cost(lv);
    const upgrade = document.getElementById('bld-up'), affordable = ctx.save.gold >= cost(lv);
    upgrade.disabled = !affordable;
    upgrade.textContent = affordable ? '업그레이드' : '골드 부족';
    upgrade.style.opacity = affordable ? '1' : '0.65';
    upgrade.style.cursor = affordable ? 'pointer' : 'not-allowed';
    upgrade.setAttribute('aria-describedby', 'bld-desc bld-cost');
    const plan = nextExpeditionPlan(ctx.save);
    chooseRegion(selectedRegion);
    document.getElementById('base-growth').textContent = `추천 ${plan.name}: ${plan.benefit} · ${plan.shortage ? plan.shortage + '골드 더' : '강화 가능'}`;
    reflowLabels();
  }
  document.getElementById('bld-next').onclick = () => { sel = (sel + 1) % BLD.length; upd(); };
  document.getElementById('bld-up').onclick = () => {
    const b = BLD[sel], lv = ctx.save[b.key], c = cost(lv);
    if (ctx.save.gold < c) { document.getElementById('bld-desc').textContent = '골드가 부족합니다!'; return; }
    ctx.save.gold -= c; ctx.save[b.key]++; ctx.persist(); upd();
  };
  upd();

  (function loop() {
    if (scr.classList.contains('hidden')) {
      // 복귀는 새 페이지이므로 숨은 기지의 GPU 컨텍스트/리사이즈 참조를 남기지 않음.
      window.removeEventListener('resize', resize);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      ground.geometry.dispose(); ground.material.dispose();
      ball.geometry.dispose(); ball.material.dispose();
      return;
    }
    if (needsRender) { renderer.render(scene, camera); needsRender = false; } // the base scene has no moving objects
    requestAnimationFrame(loop);
  })();
}
