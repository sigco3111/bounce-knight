import { startBase } from './base.js';
import { startBattle } from './battle.js';

const SAVE_KEY = 'bounceknight_save_v1'; // unique under sigco3111.github.io (origin is shared with other games)
const OLD_KEY = 'bb_save_v1';
const storage = (() => { try { const t = '__bb_t'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch (e) { const mem = {}; return { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }; } })();
let save = JSON.parse(storage.getItem(SAVE_KEY) || 'null');
if (!save) {
  // One-time migration from the old generic key. This origin is shared with
  // other games, so import only when the value matches this game's exact save
  // schema, and never delete the old key (it may belong to another game).
  const old = storage.getItem(OLD_KEY);
  if (old) {
    try {
      const o = JSON.parse(old);
      const F = ['gold', 'castleLv', 'forgeLv', 'tavernLv', 'bestWave'];
      if (o && typeof o === 'object' && !Array.isArray(o)
          && F.every(k => typeof o[k] === 'number') && Object.keys(o).every(k => F.includes(k))) {
        save = o;
        storage.setItem(SAVE_KEY, JSON.stringify(o));
      }
    } catch (e) { /* not this game's save; leave it untouched */ }
  }
}
save = save || {
  gold: 120, castleLv: 1, forgeLv: 1, tavernLv: 1, bestWave: 0,
};
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
  if (auto) document.getElementById('btn-sortie').click();
}
async function showBattle() {
  scrBase.classList.add('hidden');
  scrBattle.classList.remove('hidden');
  current = 'battle';
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
