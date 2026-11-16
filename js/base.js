import * as THREE from 'three';
import { loadModel, HtmlLabels } from './common.js';

const BLD = [
  { key: 'castleLv', name: '성', desc: lv => `영웅 최대 HP ${3 + lv - 1} → ${3 + lv}` },
  { key: 'forgeLv', name: '대장간 · 강화', desc: lv => `모든 공 피해량 +${(lv - 1) * 20}% → +${lv * 20}%` },
  { key: 'tavernLv', name: '주점 · 공 합성', desc: lv => `출격 시 기본 공 ${lv}개 → ${lv + 1}개` },
];
const cost = lv => 60 * lv;

export async function startBase(ctx) {
  // ctx: { save, persist(), onSortie() }
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const scr = document.getElementById('screen-base');
  // bind the sortie CTA before any model loads: the button is visible HTML and must never be dead on slow networks
  document.getElementById('btn-sortie').onclick = () => ctx.onSortie();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  scr.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1c);
  scene.fog = new THREE.Fog(0x0a0f1c, 10, 26);
  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 80);
  window.addEventListener('resize', () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });
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
    return { x: (p.x * 0.5 + 0.5) * W(), y: (-p.y * 0.5 + 0.5) * H() };
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
  const tagItems = {};
  for (const [k, sp] of Object.entries(spots)) {
    const m = await loadModel(sp.model, { h: sp.h, x: sp.pos[0], z: sp.pos[1], y: tileTop });
    scene.add(m.obj);
    const name = BLD.find(b => b.key === k)?.name || sp.label;
    tagItems[k] = labels.add('tag3d', '');
    const p = proj(new THREE.Vector3(sp.pos[0], m.topY !== undefined ? 0 : 0, sp.pos[1]));
    // compute label position from building top
    const box = new THREE.Box3().setFromObject(m.obj);
    const pp = proj(new THREE.Vector3(sp.pos[0], box.max.y + 0.25, sp.pos[1]));
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
  function upd() {
    document.getElementById('base-gold').textContent = ctx.save.gold;
    document.getElementById('base-best').textContent = ctx.save.bestWave;
    for (const [k, it] of Object.entries(tagItems)) {
      const b = BLD.find(x => x.key === k);
      it.el.innerHTML = b ? `${b.name} <span class="lv">Lv.${ctx.save[k]}</span>` : it.el.dataset.name;
    }
    const b = BLD[sel], lv = ctx.save[b.key];
    document.getElementById('bld-name').textContent = `${b.name} Lv.${lv}`;
    document.getElementById('bld-desc').textContent = b.desc(lv);
    document.getElementById('bld-cost').textContent = '🪙 ' + cost(lv);
  }
  document.getElementById('bld-next').onclick = () => { sel = (sel + 1) % BLD.length; upd(); };
  document.getElementById('bld-up').onclick = () => {
    const b = BLD[sel], lv = ctx.save[b.key], c = cost(lv);
    if (ctx.save.gold < c) { document.getElementById('bld-desc').textContent = '골드가 부족합니다!'; return; }
    ctx.save.gold -= c; ctx.save[b.key]++; ctx.persist(); upd();
  };
  upd();

  (function loop() { renderer.render(scene, camera); requestAnimationFrame(loop); })();
}
