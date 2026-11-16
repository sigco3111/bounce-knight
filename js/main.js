import { startBase } from './base.js';
import { startBattle } from './battle.js';

const SAVE_KEY = 'bounceknight_save_v1'; // unique under sigco3111.github.io (origin is shared with other games)
const OLD_KEY = 'bb_save_v1';
let storageAvailable = true;
const storage = {
  getItem: k => { try { return localStorage.getItem(k); } catch (_) { storageAvailable = false; return null; } },
  setItem: (k, v) => localStorage.setItem(k, v),
};
try { const t = '__bb_t'; storage.setItem(t, '1'); localStorage.removeItem(t); } catch (_) { storageAvailable = false; }
const defaults = () => ({ gold: 120, castleLv: 1, forgeLv: 1, tavernLv: 1, bestWave: 0 });
const saveFields = ['gold', 'castleLv', 'forgeLv', 'tavernLv', 'bestWave'];
const validSave = o => o && typeof o === 'object' && !Array.isArray(o) &&
  saveFields.every(k => Number.isSafeInteger(o[k]) && o[k] >= (k.endsWith('Lv') ? 1 : 0));
const rawSave = storage.getItem(SAVE_KEY);
let save = defaults(), sessionOnly = !storageAvailable;
if (rawSave !== null) {
  try {
    const parsed = JSON.parse(rawSave);
    if (!validSave(parsed)) throw new Error('invalid save');
    save = parsed;
  } catch (_) { sessionOnly = true; } // 원본은 삭제/덮어쓰기하지 않는다.
}
// A previous build used the generic key OLD_KEY on this shared origin. Never
// import it automatically (schema match does not prove ownership) and never
// delete it (it may belong to another game). Offer the user a one-time choice.
function offerLegacyImport() {
  if (sessionOnly || storage.getItem(SAVE_KEY)) return;
  const old = storage.getItem(OLD_KEY);
  if (!old) return;
  let o; try { o = JSON.parse(old); } catch (e) { return; }
  const F = ['gold', 'castleLv', 'forgeLv', 'tavernLv', 'bestWave'];
  if (!(validSave(o) && Object.keys(o).every(k => F.includes(k)))) return;
  const bar = document.createElement('div');
  bar.id = 'legacy-save';
  bar.innerHTML = `이전 버전 저장 발견 (🪙 ${o.gold} · 최고 웨이브 ${o.bestWave}) <button id="legacy-yes">가져오기</button><button id="legacy-no">무시</button>`;
  document.getElementById('screen-base').appendChild(bar);
  document.getElementById('legacy-yes').onclick = () => { const previous = { ...save }; Object.assign(save, o); if (persist()) location.reload(); else { Object.assign(save, previous); bar.remove(); } };
  document.getElementById('legacy-no').onclick = () => { persist(); bar.remove(); };
}
function showSessionNotice() {
  if (document.getElementById('save-session-notice')) return;
  const badge = document.createElement('div'); badge.id = 'save-session-notice';
  badge.setAttribute('role', 'status');
  badge.textContent = '임시 플레이 · 저장 안 됨 · 새로고침 시 초기화';
  badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:30;text-align:center;font-size:10px;line-height:13px;color:#ffe0a6;background:#332411;pointer-events:none';
  document.body.appendChild(badge);
}
function persist() {
  if (sessionOnly) return false;
  try { storage.setItem(SAVE_KEY, JSON.stringify(save)); return true; }
  catch (_) { sessionOnly = true; showSessionNotice(); return false; }
}
function confirmSessionReset() {
  const guard = document.createElement('div'); guard.className = 'overlay'; guard.id = 'save-return-guard';
  guard.setAttribute('role', 'dialog'); guard.setAttribute('aria-modal', 'true');
  guard.setAttribute('aria-labelledby', 'save-return-title'); guard.style.cssText = 'z-index:40;background:#080d19;padding:16px;box-sizing:border-box;overflow:auto';
  guard.innerHTML = `<div class="ttl" id="save-return-title" style="text-align:center;word-break:keep-all">이번 진행은 저장되지 않았습니다</div><div class="dsc" style="max-width:340px;text-align:center;line-height:1.8">브라우저에 진행을 저장할 수 없습니다.<br>기지로 돌아가면 이번 임시 플레이의<br>골드와 성장이 초기화됩니다.<br>기존 저장 원본은 삭제하지 않습니다.</div><button class="btn" type="button" style="white-space:normal">임시 진행을 초기화하고 기지로</button>`;
  document.body.appendChild(guard);
  const go = guard.querySelector('button'); go.focus();
  go.onclick = () => { go.disabled = true; location.reload(); };
}

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
  try { await startBase({ save, persist, onSortie: showBattle }); }
  catch (_) { showLoadError('base'); return; }
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
  try { await startBattle({
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
      if (sessionOnly) { confirmSessionReset(); return; }
      location.reload(); // clean 3D state by reloading into base
    },
  }); } catch (_) { showLoadError('battle'); }
}
function showLoadError(screen) {
  if (current !== screen || document.getElementById('load-error-guard')) return;
  const guard = document.createElement('div'); guard.className = 'overlay'; guard.id = 'load-error-guard';
  guard.setAttribute('role', 'dialog'); guard.setAttribute('aria-modal', 'true'); guard.setAttribute('aria-labelledby', 'load-error-title');
  guard.style.cssText = 'z-index:50;background:#080d19;padding:16px;box-sizing:border-box;overflow:auto';
  guard.innerHTML = `<div class="ttl" id="load-error-title" style="text-align:center;word-break:keep-all">화면을 불러오지 못했습니다</div><div class="dsc" style="max-width:340px;text-align:center;line-height:1.8">연결을 확인한 뒤 다시 불러와 주세요.<br>${sessionOnly ? '다시 불러오면 저장되지 않은<br>이번 임시 진행이 초기화됩니다.<br>기존 저장 원본은 삭제하지 않습니다.' : '저장된 진행은 변경하지 않았습니다.'}</div><button class="btn" type="button">${sessionOnly ? '초기화 후 다시 불러오기' : '다시 불러오기'}</button>`;
  document.body.appendChild(guard);
  const go = guard.querySelector('button'); go.style.cssText = 'max-width:100%;white-space:normal'; go.focus();
  go.onclick = () => { go.disabled = true; location.reload(); };
}
function begin() { if (params.has('battle')) showBattle(); else showBase(); }
if (sessionOnly) {
  const guard = document.createElement('div');
  guard.className = 'overlay'; guard.id = 'save-guard';
  guard.setAttribute('role', 'dialog'); guard.setAttribute('aria-modal', 'true');
  guard.setAttribute('aria-labelledby', 'save-guard-title');
  guard.style.cssText = 'z-index:40;background:#080d19;padding:16px;box-sizing:border-box;overflow:auto';
  guard.innerHTML = `<div class="ttl" id="save-guard-title" style="text-align:center;word-break:keep-all">저장 확인이 필요합니다</div><div class="dsc" style="max-width:340px;text-align:center;line-height:1.8">${storageAvailable ? '저장 데이터를 읽을 수 없습니다.<br>기존 원본은 변경하지 않았습니다.' : '브라우저에 진행을 저장할 수 없습니다.<br>이번 플레이는 임시로 진행됩니다.'}<br>임시 플레이는 저장되지 않으며<br>새로고침하면 진행이 사라집니다.</div><button class="btn" type="button">저장 없이 임시 플레이</button>`;
  document.body.appendChild(guard);
  const go = guard.querySelector('button'); go.focus();
  go.onclick = () => {
    go.disabled = true; guard.remove();
    showSessionNotice(); begin();
  };
} else begin();
