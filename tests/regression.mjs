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
  const make = () => ({ dataset: {}, classList: { add() {}, remove() {} }, focus() {}, children: [],
    appendChild(el) { this.children.push(el); this.firstElementChild = this.children[0]; },
    set innerHTML(value) { this.html = value; if (value === '') this.children = []; } });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); }, createElement: make };
  const S = { inventory: structuredClone(inventory), phase: 'play', level: 1, xp: 0, heroHP: hp, fireMul, dmgMul: 1, heroX: 0, heroZ: 0 };
  const box = vm.createContext({ S, document, Math: Object.assign(Object.create(Math), { random }),
    ctx: { auto: false, norender: true }, FIRE_INTERVAL: 0.5, clearControls() {}, updHud() {},
    xpNeed: () => 4 + S.level * 3, blip() {}, fusionFx() {}, setTimeout() {} });
  vm.runInContext(definitions + '\n' + cardLogic + '\nglobalThis.qa={levelUp,applyCard,fusiblePairs,ballDmg};', box);
  box.qa.levelUp();
  return { S, qa: box.qa, cards: elements.get('lv-cards').children };
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
    assert.deepEqual(Array.from(f.cards.slice(0, 2), c => c.dataset.kind), ['new', 'new']);
    assert.notEqual(f.cards[0].dataset.type, f.cards[1].dataset.type);
    assert.ok(['fuse', 'up'].includes(f.cards[2].dataset.kind));
    assert.ok(['mul', 'haste', 'life'].includes(f.cards[3].dataset.kind));
    const selected = i % 4, before = f.S.inventory.length;
    f.cards[selected].onclick();
    assert.equal(f.S.phase, 'play');
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
