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

// Exercise original save/load/import code in an isolated in-memory storage and DOM.
// Never run these fixtures against a browser profile or real localStorage.
function storageFixture(initial = {}, failWrites = false, failReads = false, environment = {}) {
  const data = new Map(Object.entries(initial)), writes = [], removed = [], elements = new Map();
  let reloads = 0;
  const make = () => ({ style: {}, children: [], removed: false,
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
    setAttribute() {}, focus() {}, addEventListener() {},
    remove() { this.removed = true; if (this.id) elements.delete(this.id); },
    set innerHTML(value) { this.html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) { const child = make(); child.id = match[1]; elements.set(child.id, child); } } });
  const base = make(); elements.set('screen-base', base);
  const localStorage = {
    getItem(key) { if (failReads) throw new Error('storage blocked'); return data.get(key) ?? null; },
    setItem(key, value) { if (failWrites) throw new Error('quota'); writes.push([key, value]); data.set(key, value); },
    removeItem(key) { removed.push(key); data.delete(key); }
  };
  const box = vm.createContext({ localStorage, document: { getElementById(id) { return elements.get(id) ?? null; }, createElement: make, body: make() }, location: { reload() { reloads++; } }, ...environment });
  vm.runInContext(between(main, 'const SAVE_KEY', "window.addEventListener('error'") + '\nglobalThis.qa={offerLegacyImport,persist,get save(){return save},get sessionOnly(){return sessionOnly}};', box);
  return { qa: box.qa, data, writes, removed, elements, reloads: () => reloads, blockWrites() { failWrites = true; } };
}
const currentKey = 'bounceknight_save_v1', legacyKey = 'bb_save_v1';
{
  const f = storageFixture({ '__bb_t': 'unrelated existing value', 'bounceknight_storage_probe_v1': 'existing app value' });
  assert.equal(f.data.get('__bb_t'), 'unrelated existing value', 'startup must not overwrite/delete a pre-existing shared-origin key');
  assert.equal(f.data.get('bounceknight_storage_probe_v1'), 'existing app value');
  assert.ok([...f.data.keys()].every(key => !/^bounceknight_storage_probe_\d/.test(key)), 'temporary startup probe must be removed');
}

{
  const collisionKey = 'bounceknight_storage_probe_1234_' + (0.25).toString(36).slice(2);
  const f = storageFixture({ [collisionKey]: 'preserve me' }, false, false,
    { Date: { now: () => 1234 }, Math: Object.assign(Object.create(Math), { random: () => 0.25 }) });
  assert.ok(f.qa.sessionOnly);
  assert.equal(f.data.get(collisionKey), 'preserve me');
  assert.equal(f.writes.length, 0);
  assert.equal(f.removed.length, 0);
}
const oldSave = JSON.stringify({ gold: 456, castleLv: 3, forgeLv: 2, tavernLv: 1, bestWave: 9 });
for (const malformed of ['{', '{}', 'null', '[]', JSON.stringify({ ...valid, gold: -1 })]) {
  const f = storageFixture({ [currentKey]: malformed, [legacyKey]: oldSave });
  assert.ok(f.qa.sessionOnly);
  f.qa.offerLegacyImport(); assert.ok(!f.elements.has('legacy-save'));
  f.qa.save.gold += 100; assert.equal(f.qa.persist(), false);
  assert.equal(f.data.get(currentKey), malformed); assert.equal(f.data.get(legacyKey), oldSave);
  assert.ok(!f.removed.includes(currentKey) && !f.removed.includes(legacyKey));
}
{
  const f = storageFixture({ [legacyKey]: oldSave });
  f.qa.offerLegacyImport(); assert.ok(f.elements.has('legacy-save'));
  assert.equal(f.qa.save.gold, 120); assert.ok(!f.data.has(currentKey));
  f.elements.get('legacy-yes').onclick();
  assert.equal(f.qa.save.gold, 456); assert.equal(f.data.get(currentKey), oldSave);
  assert.equal(f.data.get(legacyKey), oldSave); assert.equal(f.reloads(), 1);
}
{
  const f = storageFixture({ [legacyKey]: oldSave });
  f.qa.offerLegacyImport(); f.elements.get('legacy-no').onclick();
  assert.equal(f.qa.save.gold, 120); assert.equal(JSON.parse(f.data.get(currentKey)).gold, 120);
  assert.equal(f.data.get(legacyKey), oldSave); assert.equal(f.reloads(), 0);
  assert.ok(!f.elements.has('legacy-save'));
}
{
  const f = storageFixture({ [currentKey]: oldSave, [legacyKey]: oldSave });
  assert.equal(f.qa.save.gold, 456); f.qa.offerLegacyImport();
  assert.ok(!f.elements.has('legacy-save')); assert.equal(f.writes.length, 1); // startup capability probe only
}
for (const legacy of ['{', '{}', JSON.stringify({ ...JSON.parse(oldSave), otherGame: true })]) {
  const f = storageFixture({ [legacyKey]: legacy }); f.qa.offerLegacyImport();
  assert.ok(!f.elements.has('legacy-save')); assert.ok(!f.data.has(currentKey)); assert.equal(f.data.get(legacyKey), legacy);
}
for (const failReads of [false, true]) {
  const f = storageFixture({ [currentKey]: oldSave, [legacyKey]: oldSave }, true, failReads);
  assert.ok(f.qa.sessionOnly); assert.equal(f.qa.persist(), false);
  assert.equal(f.data.get(currentKey), oldSave); assert.equal(f.data.get(legacyKey), oldSave);
}
{
  const f = storageFixture({ [legacyKey]: oldSave });
  f.qa.offerLegacyImport(); f.blockWrites(); f.elements.get('legacy-yes').onclick();
  assert.equal(f.qa.save.gold, 120); assert.ok(f.qa.sessionOnly);
  assert.ok(!f.data.has(currentKey)); assert.equal(f.data.get(legacyKey), oldSave);
  assert.equal(f.reloads(), 0); assert.ok(f.elements.has('save-session-notice'));
  assert.ok(!f.elements.has('legacy-save'));
}
{
  const f = storageFixture({ [currentKey]: oldSave }); f.blockWrites(); f.qa.save.gold += 10;
  assert.equal(f.qa.persist(), false); assert.ok(f.qa.sessionOnly);
  assert.equal(f.data.get(currentKey), oldSave); assert.ok(f.elements.has('save-session-notice'));
  assert.equal(f.qa.persist(), false);
}
console.log('PASS: isolated save flows preserve corrupt/current/legacy originals, never auto-import, require explicit import/ignore, and avoid blocked-storage writes.');

// Exercise removal/expiry with fake objects, never a real GPU or browser profile.
{
let stopped=0,uncached=0,disposed=0,bossRefresh=0;const removed=[],labels=[];
const box=vm.createContext({scene:{remove(o){removed.push(o)}},labels:{remove(o){labels.push(o)}},updBossBar(){bossRefresh++}});
vm.runInContext(between(battle, '  function clearEnemyWarning(e) {', '  function updateEnemyTactic(')+between(battle, '  function rmvEnemy(e) {', '  function killEnemy(')+'\nglobalThis.removeEnemy=rmvEnemy;',box);
const obj={geometry:{dispose(){throw Error('shared geometry disposed')}}},ice={};
const enemy={obj,iceBox:ice,label:{},mats:Array.from({length:3},()=>({dispose(){disposed++}})),mixer:{stopAllAction(){stopped++},uncacheRoot(root){assert.equal(root,obj);uncached++}}};
box.removeEnemy(enemy);assert.equal(stopped,1);assert.equal(uncached,1);assert.equal(disposed,3);assert.deepEqual(removed,[obj,ice]);assert.deepEqual(labels,[enemy.label]);assert.equal(enemy.mixer,null);assert.equal(enemy.iceBox,null);assert.equal(enemy.mats.length,0);
box.removeEnemy(enemy);assert.equal(stopped,1);assert.equal(disposed,3);
assert.equal(bossRefresh,0);
box.removeEnemy({obj:{},type:'boss',label:{},mats:[]});assert.equal(bossRefresh,1); // all boss removal paths refresh the bar
console.log('PASS exact rmvEnemy: mixer stopped/uncached, personal materials disposed once, ice/labels removed, shared geometry untouched.');
let deaths=0,fxCalls=0;const purged=[];
function mesh(){return {position:{x:0,y:1,z:0},rotation:{x:0,y:0},scale:{setScalar(k){assert.ok(Number.isFinite(k));this.value=k}},material:{opacity:1,dispose(){deaths++}},geometry:{dispose(){throw Error('shared FX geometry disposed')}}}}
function part(t,ttl){return {mesh:mesh(),t,ttl,vx:1,vy:2,vz:3}}
function ring(t,ttl){return {mesh:mesh(),t,ttl,maxR:2}}
const livePart=part(0,0.25),liveRing=ring(0,0.25);
const S={parts:[...Array.from({length:500},()=>part(.2,.25)),livePart],rings:[...Array.from({length:500},()=>ring(.2,.25)),liveRing],fxQueue:[{remaining:.05,run(){fxCalls++}},{remaining:.25,run(){fxCalls++}}]};
const parts=S.parts,rings=S.rings;const fxBox=vm.createContext({S,dt:.1,scene:{remove(m){purged.push(m)}}});
const tick='{'+between(battle, '    const dueFx = [];', '    // balls')+'}';vm.runInContext(tick,fxBox);assert.equal(fxCalls,1);assert.equal(S.fxQueue.length,1);assert.equal(deaths,1000);assert.equal(purged.length,1000);assert.equal(S.parts,parts);assert.equal(S.rings,rings);assert.equal(S.parts.length,1);assert.equal(S.parts[0],livePart);assert.equal(S.rings[0],liveRing);
vm.runInContext(tick,fxBox);assert.equal(deaths,1000);assert.equal(fxCalls,1);vm.runInContext(tick,fxBox);assert.equal(deaths,1002);assert.equal(fxCalls,2);assert.equal(S.parts.length,0);assert.equal(S.rings.length,0);assert.equal(S.fxQueue.length,0);
vm.runInContext(tick,fxBox);assert.equal(deaths,1002);assert.equal(fxCalls,2);
console.log('PASS exact FX tick: 1000 simultaneous expirations, stable live entries, one disposal each, shared geometry untouched, delayed effects once. Not a GPU-memory benchmark.');
}

// A denied asynchronous audio resume must not become an unhandled rejection.
{
  const rejections = [];
  const onRejected = reason => rejections.push(reason);
  process.on('unhandledRejection', onRejected);
  try {
    class RefusedAudioContext extends TestAudioContext {
      constructor() { super(); this.state = 'suspended'; }
      resume() { return Promise.reject(new Error('modeled audio permission denied')); }
    }
    const deniedAudio = vm.createContext({ window: { AudioContext: RefusedAudioContext }, localStorage: { getItem() { return null; }, setItem() {} } });
    vm.runInContext(between(common, 'const AUDIO_KEY', 'export const BALL_TYPES').replaceAll('export ', '') + '\nglobalThis.qa={blip,setAudioPaused};', deniedAudio);
    for (let i = 0; i < 10; i++) deniedAudio.qa.blip();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejections.length, 0);
    deniedAudio.qa.setAudioPaused(true);
    assert.equal(liveVoices, 0);
  } finally { process.off('unhandledRejection', onRejected); }
  console.log('PASS: denied modeled audio resumes do not leak asynchronous errors. Not a device permission or listening test.');
}

// Front-row gems must reach a lane the hero can enter, with no XP/radius buff.
const gemTick = between(battle, '    // gems\n', '\n  // ---- main loop ----');
function gemReach(z, heroZ = -2.6) {
  const position = { y: 0, z, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const g = { x: 0, z, ttl: 12, mesh: { rotation: { y: 0 }, position, scale: { setScalar() {} } } };
  const S = { gems: [g], heroX: 0, heroZ, now: 0, xp: 0, gemsGot: 0 };
  const box = vm.createContext({ S, HERO_Z_MIN: -2.6, Math, dt: 0.05, scene: { remove() {} }, ring() {}, blip() {}, updHud() {}, xpNeed: () => 7, levelUp() {} });
  // The last brace in this boundary closes step(), not the gem loop.
  const code = gemTick.slice(0, gemTick.lastIndexOf('\n  }'));
  for (let i = 0; i < 200 && S.gems.length; i++) vm.runInContext("(()=>{" + code + "})()", box);
  return S;
}
assert.equal(gemReach(-7.2).gemsGot, 1);
assert.equal(gemReach(-7.2).xp, 1);
assert.equal(gemReach(0, 3.4).xp, 0); // ordinary distant drops are not globally auto-collected
console.log('PASS: unreachable front-row drop enters reachable lane and awards exactly one XP; ordinary pickup range unchanged.');

// Combinations consume a prior status, rather than becoming a permanent damage buff.
const reactionBox = vm.createContext({});
vm.runInContext(common.slice(common.indexOf('export function ballReaction')).replaceAll('export ', '') + '\nglobalThis.react=ballReaction;', reactionBox);
assert.equal(reactionBox.react(ball('iron'), { frozen: 1 }).damage, 2);
assert.equal(reactionBox.react(ball('iron', 1, true), { frozen: 1 }).damage, 4);
assert.equal(reactionBox.react(ball('iron'), { frozen: 0 }), null);
assert.equal(reactionBox.react(ball('fire'), { poison: { dps: 3, t: 4 } }).damage, 3);
assert.equal(reactionBox.react(ball('fire'), { poison: { dps: 3, t: 0.2 } }).damage, 1);
assert.equal(reactionBox.react(ball('bolt'), { frozen: 1, poison: { dps: 3, t: 4 } }), null);
const damageLogic = between(battle, '  function damageEnemy(', '  function updBossBar(');
function reactHit(type, status) {
  const e = { hp: 100, mats: [], x: 0, z: 0, h: 1, ...status };
  const S = { enemies: [e], reactions: 0, evolvedHits: 0 };
  const box = vm.createContext({ S, Math, ctx: { norender: true }, ballReaction: reactionBox.react, ballDmg: () => 1, BALL_TYPES: { iron: { color: 0 }, fire: { color: 0 } }, scene: { remove() {} }, blip() {}, typeHitBurst() {}, updHud() {}, updEnemyLabel() {}, updBossBar() {}, killEnemy() {} });
  vm.runInContext(damageLogic + '\nglobalThis.hit=damageEnemy;', box);
  const src = { def: ball(type) };
  box.hit(e, 1, src); const first = e.hp; box.hit(e, 1, src);
  return { e, S, first };
}
let rh = reactHit('iron', { frozen: 1, iceBox: {} });
assert.equal(rh.first, 97); assert.equal(rh.e.hp, 96); assert.equal(rh.e.frozen, 0); assert.equal(rh.e.iceBox, null); assert.equal(rh.S.reactions, 1);
rh = reactHit('fire', { poison: { dps: 3, t: 4 } });
assert.equal(rh.first, 96); assert.equal(rh.e.hp, 95); assert.equal(rh.e.poison, null); assert.equal(rh.S.reactions, 1);
console.log('PASS: ice+iron shatter and poison+fire ignition formulas; actual hit handler consumes status and triggers once.');

// Telegraphs lock a target, pause with the battle, and stop owning resources on removal.
{
const S = { now: 0, heroX: 1, heroZ: 3.4, over: false }; let hurts=0, warningsRemoved=0, warningDisposed=0;
class Mesh { constructor(g,m){this.material=m;this.rotation={};this.position={set(){}};this.scale={set(){}};} }
class Mat { dispose(){warningDisposed++;} }
const box = vm.createContext({ S, Math, ctx:{norender:false}, THREE:{Mesh,MeshBasicMaterial:Mat,DoubleSide:2}, chargeWarningGeo:{},spellWarningGeo:{}, scene:{add(){},remove(){warningsRemoved++;}}, updBossBar(){},ring(){},hurtHero(){hurts++;} });
vm.runInContext(between(battle,'  function clearEnemyWarning(e) {','  // ---- fx: particle bursts ----')+'\nglobalThis.qa={updateEnemyTactic,clearEnemyWarning};',box);
const obj=()=>({position:{x:0}});
const boss={type:'boss',z:-4,x:0,obj:obj(),intent:{stage:'idle',left:0}};
assert.equal(box.qa.updateEnemyTactic(boss,.05),0);assert.equal(boss.intent.stage,'warn');assert.ok(boss.warning);assert.equal(boss.intent.x,1);
S.heroX=-2;const saved=JSON.stringify(boss.intent);assert.equal(JSON.stringify(boss.intent),saved); // no tick means no timer progression
for(let i=0;i<30;i++)box.qa.updateEnemyTactic(boss,.05);
assert.equal(boss.intent.stage,'charge');assert.equal(boss.intent.x,1);assert.equal(boss.warning,null);
assert.equal(box.qa.updateEnemyTactic(boss,.05),12);
boss.z=boss.intent.endZ;assert.equal(box.qa.updateEnemyTactic(boss,.05),0);assert.equal(boss.intent.stage,'idle');
const mage={type:'mage',x:0,z:-3,obj:obj(),intent:{stage:'idle',left:0}};
box.qa.updateEnemyTactic(mage,.05);const tx=mage.intent.x;
S.heroX=tx+1.5;for(let i=0;i<26;i++)box.qa.updateEnemyTactic(mage,.05);assert.equal(hurts,0); // dodge locked mark
mage.intent={stage:'idle',left:0};box.qa.updateEnemyTactic(mage,.05);for(let i=0;i<26;i++)box.qa.updateEnemyTactic(mage,.05);assert.equal(hurts,1);
mage.intent={stage:'idle',left:0};box.qa.updateEnemyTactic(mage,.05);box.qa.clearEnemyWarning(mage);box.qa.clearEnemyWarning(mage);assert.equal(warningsRemoved,4);assert.equal(warningDisposed,4);
const rogue={type:'rogue',originX:2.3,id:4,x:2.3,obj:obj()};for(let i=0;i<100;i++){S.now=i*.1;box.qa.updateEnemyTactic(rogue,.1);assert.ok(Math.abs(rogue.x)<=2.4);}
console.log('PASS: locked boss charge/mage ground mark, dodge versus hit, warning disposal once, bounded rogue sidesteps. Modeled, not natural difficulty testing.');
}

// Base/return previews use earned gold but never mutate or purchase anything.
{
const box=vm.createContext({Math});
vm.runInContext(common.slice(common.indexOf('export function nextExpeditionPlan')).replace('export ','')+'\nglobalThis.plan=nextExpeditionPlan;',box);
const save={gold:40,castleLv:2,forgeLv:1,tavernLv:1,bestWave:7}; const before=JSON.stringify(save);
const p=box.plan(save,37);assert.equal(p.target,10);assert.equal(p.name,'대장간');assert.equal(p.gold,77);assert.equal(p.cost,60);assert.equal(p.shortage,0);assert.equal(JSON.stringify(save),before);
assert.equal(box.plan({...save,gold:0}).shortage,60);
assert.equal(box.plan({...save,bestWave:10}).target,15);
assert.equal(box.plan({gold:120,castleLv:1,forgeLv:1,tavernLv:1,bestWave:0}).name,'성');
console.log('PASS: next-run goal/upgrade preview matches milestone, gold, cost, shortage and effect; no save mutation or purchase.');
}
