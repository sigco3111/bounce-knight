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
  let mixer = null;
  if (g.animations && g.animations.length && opt.poseT !== false) {
    const mx = new THREE.AnimationMixer(o);
    const clip = (opt.animation && g.animations.find(a => a.name === opt.animation)) || g.animations.find(a => /idle/i.test(a.name)) || g.animations[0];
    mx.clipAction(clip).play();
    mx.update(opt.poseT != null ? opt.poseT : 0.5);
    if (opt.animate) mixer = mx;
  }
  return { obj: o, h: size.y * s, w: size.x * s, mixer, animations: g.animations || [] };
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
  // HP 라벨과 같은 컨테이너를 쓰므로 팝업만 제한. 적 라벨은 지우지 않는다.
  const activePopups = container.querySelectorAll(':scope > .popup');
  for (let i = 0; i <= activePopups.length - 40; i++) activePopups[i].remove();
  const d = document.createElement('div');
  d.className = 'popup ' + cls;
  d.textContent = text;
  d.style.left = x + 'px'; d.style.top = y + 'px';
  container.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}

const AUDIO_KEY = 'bounceknight_audio_muted_v1';
let audioMuted = false, audioPaused = false;
try { audioMuted = localStorage.getItem(AUDIO_KEY) === '1'; } catch (_) { /* session setting only */ }
const MAX_VOICES = 16;
const voices = new Map();
function stopVoice(o) {
  const voice = voices.get(o); if (!voice) return;
  voices.delete(o);
  try { o.stop(); } catch (_) { /* already ended */ }
  o.disconnect(); voice.gain.disconnect();
}
function stopVoices() { for (const o of voices.keys()) stopVoice(o); }
export const isAudioMuted = () => audioMuted;
export function setAudioMuted(muted) {
  audioMuted = !!muted;
  if (audioMuted) stopVoices();
  try { localStorage.setItem(AUDIO_KEY, audioMuted ? '1' : '0'); } catch (_) { /* keep session choice */ }
}
export function setAudioPaused(paused) { audioPaused = !!paused; if (audioPaused) stopVoices(); }
let actx = null;
export function blip(f = 440, d = 0.05, type = 'square', g = 0.035, priority = 0) {
  if (audioMuted || audioPaused) return;
  if (voices.size >= MAX_VOICES) {
    let victim = null, lowest = Infinity;
    for (const [o, voice] of voices) if (voice.priority < lowest) { victim = o; lowest = voice.priority; }
    if (priority <= lowest) return;
    stopVoice(victim); // health/end cues may replace an older routine shot or impact
  }
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume().catch(() => {}); // browser may deny audio; gameplay must stay usable
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type; o.frequency.value = f;
    gn.gain.setValueAtTime(g, actx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(gn); gn.connect(actx.destination);
    voices.set(o, { priority, gain: gn });
    o.onended = () => { if (!voices.has(o)) return; voices.delete(o); o.disconnect(); gn.disconnect(); };
    o.start(); o.stop(actx.currentTime + d);
  } catch (e) { /* no audio */ }
}

export const BALL_TYPES = {
  iron: { name: '철구',  color: 0xb8c4d4, css: '#b8c4d4', desc: '동결된 적을 치면 쇄빙 +2 (강철구 +4).' },
  fire: { name: '화염구', color: 0xff5a1a, css: '#ff6a2a', desc: '주변 폭발. 중독된 적은 독을 소모해 점화.' },
  ice:  { name: '빙결구', color: 0x6ec8ff, css: '#6ec8ff', desc: '적을 동결. 철구로 치면 동결을 깨고 추가 피해.' },
  bolt: { name: '번개구', color: 0xffe14d, css: '#ffe14d', desc: '적중 시 가장 가까운 다른 적에게 연쇄.' },
  poison: { name: '독구', color: 0x7ddc3f, css: '#7ddc3f', desc: '지속 피해. 화염으로 치면 남은 독 1초분 즉시 피해.' },
};
export const EVOLVED = {
  fire: { name: '작열구', desc: '더 넓은 폭발과 강한 피해.' },
  ice:  { name: '혹한구', desc: '더 오래 얼리는 강력한 냉기.' },
  bolt: { name: '뇌전구', desc: '여러 적에게 튀는 연쇄 번개.' },
  iron: { name: '강철구', desc: '동결을 깨면 추가 피해 4. 동결 소모.' },
  poison: { name: '맹독구', desc: '더 강하고 오래 퍼지는 맹독.' },
};
export function ballName(b) { return (b.evolved ? EVOLVED[b.type].name : BALL_TYPES[b.type].name) + ' Lv.' + b.lv; }
export function ballDmg(b) { const base = b.evolved ? 2 + b.lv * 2 : b.lv; return base; }

export function isLite() { return new URLSearchParams(location.search).has('lite'); }

// Reactions consume the prior status once; they are not multiplied by direct-hit upgrades.
export function ballReaction(def, enemy) {
  if (def.type === 'iron' && enemy.frozen > 0) return { kind: 'shatter', damage: def.evolved ? 4 : 2 };
  if (def.type === 'fire' && enemy.poison?.t > 0) return { kind: 'ignite', damage: Math.max(1, Math.ceil(enemy.poison.dps * Math.min(1, enemy.poison.t))) };
  return null;
}
