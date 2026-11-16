// Fast logic checks. These do not replace browser, touch, graphics or listening tests.
// Run from any directory: node tests/regression.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const battle = fs.readFileSync(new URL('js/battle.js', root), 'utf8');
const common = fs.readFileSync(new URL('js/common.js', root), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing test boundary: ${start}`);
  return source.slice(a, b);
}
const definitions = between(common, 'export const BALL_TYPES', 'export function isLite').replaceAll('export ', '');
const cardLogic = between(battle, '  function fusiblePairs()', "  document.getElementById('ov-over').addEventListener");
let seed = 811;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function fixture(inventory, hp = 3, fireMul = 1) {
  const elements = new Map();
  const make = () => { const classes = new Set(); return { dataset: {}, classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); } }, focus() {}, children: [],
    appendChild(el) { this.children.push(el); this.firstElementChild = this.children[0]; },
    set innerHTML(value) { this.html = value; if (value === '') this.children = []; } }; };
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); }, createElement: make };
  const S = { inventory: structuredClone(inventory), phase: 'play', level: 1, xp: 0, heroHP: hp, fireMul, dmgMul: 1, heroX: 0, heroZ: 0 };
  const box = vm.createContext({ S, document, scr: document.getElementById('screen-battle'), Math: Object.assign(Object.create(Math), { random }),
    ctx: { auto: false, norender: true }, FIRE_INTERVAL: 0.5, clearControls() {}, updHud() {},
    xpNeed: () => 4 + S.level * 3, blip() {}, fusionFx() {}, setTimeout() {} });
  vm.runInContext(definitions + '\n' + cardLogic + '\nglobalThis.qa={levelUp,applyCard,fusiblePairs,ballDmg};', box);
  box.qa.levelUp();
  return { S, scr: document.getElementById('screen-battle'), qa: box.qa, cards: elements.get('lv-cards').children };
}
const ball = (type = 'iron', lv = 1, evolved = false) => ({ type, lv, evolved });
let cases = 0;
for (let i = 0; i < 400; i++) {
  for (const inventory of [
    [ball(), ball(), ball()],
    [ball('fire', 2), ball('ice', 1)],
    [ball('iron', 1, true), ball('iron', 1, true)],
    [ball('poison', 3, true), ball('fire', 2)],
  ]) {
    const f = fixture(inventory);
    assert.equal(f.cards.length, 4);
    assert.ok(f.scr.classList.contains('choice-dialog-open'));
    assert.deepEqual(Array.from(f.cards.slice(0, 2), c => c.dataset.kind), ['new', 'new']);
    assert.notEqual(f.cards[0].dataset.type, f.cards[1].dataset.type);
    assert.ok(['fuse', 'up'].includes(f.cards[2].dataset.kind));
    assert.ok(['mul', 'haste', 'life'].includes(f.cards[3].dataset.kind));
    const selected = i % 4, before = f.S.inventory.length;
    f.cards[selected].onclick();
    assert.equal(f.S.phase, 'play');
    assert.equal(f.scr.classList.contains('choice-dialog-open'), false);
    const after = f.S.inventory.length;
    assert.equal(after, before + (selected < 2 ? 1 : f.cards[selected].dataset.kind === 'fuse' ? -1 : 0));
    const snapshot = JSON.stringify(f.S);
    f.cards[selected].onclick(); // stale/double activation cannot apply a second choice
    assert.equal(JSON.stringify(f.S), snapshot);
    cases++;
  }
}
let f = fixture([ball('iron', 1, true), ball('iron', 1, true)]);
assert.equal(f.qa.fusiblePairs(), null);
assert.equal(f.cards[2].dataset.kind, 'up');
f.cards[2].onclick();
assert.deepEqual(Array.from(f.S.inventory, b => b.lv).sort(), [1, 2]);
assert.deepEqual(Array.from(f.S.inventory, b => f.qa.ballDmg(b)).sort((a, b) => a - b), [4, 6]);
f = fixture([ball('poison', 3, true), ball('fire', 2)]);
f.cards[2].onclick(); // non-evolved ball remains the first upgrade choice
assert.deepEqual(Array.from(f.S.inventory, b => b.lv), [3, 3]);
f = fixture([ball()], 5, 0.6);
assert.equal(f.cards[3].dataset.kind, 'mul'); // full HP and capped haste excluded
console.log(`PASS: ${cases} seeded card selections; distinct new balls, growth priority, evolved-only growth, one choice, damage formulas, passive limits.`);

// Save validation tests use the exact predicate; no browser storage is read or written.
const main = fs.readFileSync(new URL('js/main.js', root), 'utf8');
const saveBox = vm.createContext({});
vm.runInContext(between(main, 'const defaults =', 'const rawSave =') + '\nglobalThis.qa={defaults,validSave};', saveBox);
const valid = saveBox.qa.defaults();
assert.ok(saveBox.qa.validSave(valid));
for (const value of [null, [], {}, 'save', 0]) assert.ok(!saveBox.qa.validSave(value));
for (const field of ['gold', 'castleLv', 'forgeLv', 'tavernLv', 'bestWave']) {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '120', null])
    assert.ok(!saveBox.qa.validSave({ ...valid, [field]: value }), `${field} accepts invalid ${value}`);
  assert.ok(!saveBox.qa.validSave(Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field))));
}
for (const field of ['castleLv', 'forgeLv', 'tavernLv']) assert.ok(!saveBox.qa.validSave({ ...valid, [field]: 0 }));
console.log('PASS: save predicate rejects missing, fractional, negative, unsafe and wrong-type values. No storage mutations.');

// Model the sound graph to check limits and cleanup, not sound quality or audibility.
let liveVoices = 0, stopped = 0, disconnected = 0;
const oscillators = [];
class TestAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  resume() { return Promise.resolve(); }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; } }; }
  createOscillator() {
    liveVoices++;
    const node = { frequency: { value: 0 }, connect() {}, disconnect() { disconnected++; liveVoices--; },
      start() {}, stop() { stopped++; } };
    oscillators.push(node); return node;
  }
}
const audioBox = vm.createContext({ window: { AudioContext: TestAudioContext }, localStorage: { getItem() { return null; }, setItem() {} } });
vm.runInContext(between(common, 'const AUDIO_KEY', 'export const BALL_TYPES').replaceAll('export ', '') + '\nglobalThis.qa={blip,setAudioMuted,setAudioPaused};', audioBox);
for (let i = 0; i < 200; i++) audioBox.qa.blip();
assert.equal(liveVoices, 16);
audioBox.qa.blip(120, 0.2, 'sawtooth', 0.05, 1);
assert.equal(liveVoices, 16);
assert.equal(oscillators.length, 17); // high priority replaces one old routine voice
assert.equal(disconnected, 2);
audioBox.qa.setAudioPaused(true);
assert.equal(liveVoices, 0);
const count = oscillators.length;
audioBox.qa.blip(); assert.equal(oscillators.length, count);
audioBox.qa.setAudioPaused(false); audioBox.qa.setAudioMuted(true);
audioBox.qa.blip(); assert.equal(oscillators.length, count);
audioBox.qa.setAudioMuted(false); audioBox.qa.blip();
assert.equal(liveVoices, 1);
oscillators.at(-1).onended();
assert.equal(liveVoices, 0);
assert.equal(disconnected, oscillators.length * 2);
assert.ok(stopped >= oscillators.length);
console.log('PASS: modeled audio cap 16, priority replacement, pause/mute suppression and oscillator/gain cleanup. Not a listening test.');
