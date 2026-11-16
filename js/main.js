import { startBase } from './base.js';
import { startBattle } from './battle.js';

const SAVE_KEY = 'bounceknight_save_v1'; // unique under sigco3111.github.io (origin is shared with other games)
const OLD_KEY = 'bb_save_v1';
const storage = (() => { try { const t = '__bb_t'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch (e) { const mem = {}; return { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }; } })();
const save = JSON.parse(storage.getItem(SAVE_KEY) || 'null') || {
  gold: 120, castleLv: 1, forgeLv: 1, tavernLv: 1, bestWave: 0,
};
// A previous build used the generic key OLD_KEY on this shared origin. Never
// import it automatically (schema match does not prove ownership) and never
// delete it (it may belong to another game). Offer the user a one-time choice.
function offerLegacyImport() {
  if (storage.getItem(SAVE_KEY)) return;
  const old = storage.getItem(OLD_KEY);
  if (!old) return;
  let o; try { o = JSON.parse(old); } catch (e) { return; }
  const F = ['gold', 'castleLv', 'forgeLv', 'tavernLv', 'bestWave'];
  if (!(o && typeof o === 'object' && !Array.isArray(o) && F.every(k => typeof o[k] === 'number') && Object.keys(o).every(k => F.includes(k)))) return;
  const bar = document.createElement('div');
  bar.id = 'legacy-save';
  bar.innerHTML = `이전 버전 저장 발견 (🪙 ${o.gold} · 최고 웨이브 ${o.bestWave}) <button id="legacy-yes">가져오기</button><button id="legacy-no">무시</button>`;
  document.getElementById('screen-base').appendChild(bar);
  document.getElementById('legacy-yes').onclick = () => { Object.assign(save, o); persist(); location.reload(); };
  document.getElementById('legacy-no').onclick = () => { persist(); bar.remove(); };
}
function persist() { storage.setItem(SAVE_KEY, JSON.stringify(save)); }

window.addEventListener('error', e => { const s = document.getElementById('state'); s.dataset.err = (e.message||'') + ' @' + (e.filename||'') + ':' + e.lineno; });
window.addEventListener('unhandledrejection', e => { const s = document.getElementById('state'); s.dataset.rej = String(e.reason && (e.reason.stack || e.reason.message || e.reason)).slice(0, 300); });
const params = new URLSearchParams(location.search);
const auto = params.has('auto'), fast = params.has('fast'), inputTest = params.has('inputtest'), norender = params.has('norender'), probe = params.has('probe');

const scrBase = document.getElementById('screen-base');
const scrBattle = document.getElementById('screen-battle');
let current = null;

const mark = s => { const el = document.getElementById('state'); el.dataset.marks = (el.dataset.marks || '') + '|' + s; };
async function showBase() {
  mark('showBase');
  scrBattle.classList.add('hidden');
  scrBase.classList.remove('hidden');
  if (current === 'base') return;
  current = 'base';
  await startBase({ save, persist, onSortie: showBattle });
  offerLegacyImport();
  if (auto) document.getElementById('btn-sortie').click();
}
async function showBattle() {
  if (current === 'battle') return; // 빠른 연타/중복 호출도 한 전장만 생성
  current = 'battle'; // 첫 await 전에 잠금
  document.getElementById('btn-sortie').disabled = true;
  scrBase.classList.add('hidden');
  scrBattle.classList.remove('hidden');
  // reset battle screen DOM (labels/hud) by reloading page state instead of cloning: simplest is location-based; here we just clear labels
  document.getElementById('bt-labels').innerHTML = '';
  document.getElementById('ov-over').classList.add('hidden');
  document.getElementById('ov-levelup').classList.add('hidden');
  await startBattle({
    save,
    dmgMul: () => 1 + (save.forgeLv - 1) * 0.2,
    heroMaxHP: () => 3 + save.castleLv - 1,
    extraBalls: () => save.tavernLv,
    auto, fast, inputTest, norender, probe,
    onEnd: (res) => {
      save.gold += res.gold;
      save.bestWave = Math.max(save.bestWave, res.wave);
      persist();
      if (auto) {
        document.getElementById('state').dataset.result = JSON.stringify({ ...res, saveGold: save.gold, bestWave: save.bestWave });
        return;
      }
      location.reload(); // clean 3D state by reloading into base
    },
  });
}
if (params.has('battle')) showBattle(); else showBase();
