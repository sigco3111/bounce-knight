import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();

export async function loadModel(url, opt = {}) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  const g = await cache.get(url);
  const o = SkeletonUtils.clone(g.scene);
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  let s = opt.s || 1;
  if (opt.h) s = opt.h / size.y; else if (opt.w) s = opt.w / size.x;
  o.scale.setScalar(s);
  if (opt.ry) o.rotation.y = opt.ry;
  o.position.set(opt.x || 0, 0, opt.z || 0);
  const box2 = new THREE.Box3().setFromObject(o);
  o.position.y = (opt.y || 0) - box2.min.y;
  if (g.animations && g.animations.length && opt.poseT !== false) {
    const mx = new THREE.AnimationMixer(o);
    const clip = g.animations.find(a => /idle/i.test(a.name)) || g.animations[0];
    mx.clipAction(clip).play();
    mx.update(opt.poseT != null ? opt.poseT : 0.5);
  }
  return { obj: o, h: size.y * s, w: size.x * s };
}

export function projector(camera, w, h) {
  return v => {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  };
}

export class HtmlLabels {
  constructor(container) { this.c = container; this.items = []; }
  add(cls, html) {
    const d = document.createElement('div');
    d.className = cls; d.innerHTML = html;
    this.c.appendChild(d);
    const it = { el: d };
    this.items.push(it);
    return it;
  }
  remove(it) { it.el.remove(); this.items = this.items.filter(x => x !== it); }
  clear() { this.c.innerHTML = ''; this.items = []; }
  place(it, x, y) { it.el.style.left = x + 'px'; it.el.style.top = y + 'px'; }
}

export function popup(container, x, y, text, cls = '') {
  if (container.childElementCount > 40) container.firstChild.remove();
  const d = document.createElement('div');
  d.className = 'popup ' + cls;
  d.textContent = text;
  d.style.left = x + 'px'; d.style.top = y + 'px';
  container.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}

let actx = null;
export function blip(f = 440, d = 0.05, type = 'square', g = 0.035) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type; o.frequency.value = f;
    gn.gain.setValueAtTime(g, actx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(gn); gn.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + d);
  } catch (e) { /* no audio */ }
}

export const BALL_TYPES = {
  iron: { name: '철구',  color: 0xb8c4d4, css: '#b8c4d4', desc: '기본 공. 튕기며 적을 친다.' },
  fire: { name: '화염구', color: 0xff5a1a, css: '#ff6a2a', desc: '적중 시 주변 적에게 폭발 피해.' },
  ice:  { name: '빙결구', color: 0x6ec8ff, css: '#6ec8ff', desc: '적중한 적의 다음 전진을 얼린다.' },
  bolt: { name: '번개구', color: 0xffe14d, css: '#ffe14d', desc: '적중 시 가장 가까운 다른 적에게 연쇄.' },
};
export const EVOLVED = {
  fire: { name: '작열구', desc: '더 넓은 폭발과 강한 피해.' },
  ice:  { name: '혹한구', desc: '더 오래 얼리는 강력한 냉기.' },
  bolt: { name: '뇌전구', desc: '여러 적에게 튀는 연쇄 번개.' },
  iron: { name: '강철구', desc: '묵직한 일격의 강화 철구.' },
};
export function ballName(b) { return (b.evolved ? EVOLVED[b.type].name : BALL_TYPES[b.type].name) + ' Lv.' + b.lv; }
export function ballDmg(b) { const base = b.evolved ? 2 + b.lv * 2 : b.lv; return base; }

export function isLite() { return new URLSearchParams(location.search).has('lite'); }
