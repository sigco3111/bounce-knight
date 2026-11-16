// Content rules are independent of rendering and never mutate persistence.
export const REGIONS = [
  { id: 'dungeon', name: '잿불 던전', boss: '돌진 감시자', color: 0x8b412c, sky: 0x100c14, hazard: '잿불 구역', tip: '붉은 바닥 예고에서 벗어나세요. 보스는 직선 돌진합니다.' },
  { id: 'ruins', name: '달빛 폐허', boss: '망령 소환사', color: 0x448e91, sky: 0x071a21, hazard: '유령 낙인', tip: '고정된 낙인을 피하고, 소환사와 증원 중 먼저 칠 적을 고르세요.' },
  { id: 'citadel', name: '황혼 성채', boss: '황혼 군주', color: 0x8c67b4, sky: 0x190d28, hazard: '성채 봉쇄선', tip: '가로 봉쇄선을 벗어나세요. 군주는 체력 절반부터 전술을 바꿉니다.' },
];
export const regionOpen = (save, i) => i === 0 || (save.clearedRegions || []).includes(REGIONS[i - 1]?.id);
export const regionClear = (save, id) => [...new Set([...(save.clearedRegions || []), id])].filter(x => REGIONS.some(r => r.id === x));
export function validRegionProgress(value) {
  return value === undefined || (Array.isArray(value) && value.length <= 3 && value.every(x => REGIONS.some(r => r.id === x)) && new Set(value).size === value.length);
}

export const EXPEDITION_EVENTS = { 3: 'treasure', 6: 'curse', 8: 'crossroad' };
export const EVENT_NAMES = { treasure: '잊힌 보물상자', curse: '속삭이는 저주 제단', crossroad: '원정의 갈림길' };
export function eventChoices(kind, state, maxHP) {
  const heal = n => Math.min(n, Math.max(0, maxHP - state.heroHP));
  if (kind === 'treasure') return [
    { id: 'small', title: '작은 상자', text: '골드 +20 · 위험 없음', gold: 20 },
    { id: 'sealed', title: '봉인된 상자', text: '골드 +45 · 남은 원정 적 HP +20%', gold: 45, risk: 0.2 },
  ];
  if (kind === 'curse') return [
    { id: 'rest', title: '제단을 정화한다', text: `HP ${state.heroHP} → ${state.heroHP + heal(1)} · 위험 없음`, heal: heal(1) },
    { id: 'curse', title: '저주를 받아들인다', text: `HP ${state.heroHP} → ${state.heroHP - 1} · 남은 원정 직격 배율 +0.4${state.heroHP <= 1 ? ' · HP 2 이상 필요' : ''}`, hpCost: 1, damage: 0.4, disabled: state.heroHP <= 1 },
  ];
  const b = state.inventory[0];
  return [
    { id: 'heal', title: '샘에서 회복한다', text: `HP ${state.heroHP} → ${state.heroHP + heal(2)}`, heal: heal(2) },
    { id: 'train', title: '첫 공을 강화한다', text: b ? `첫 보유 공 Lv.${b.lv} → Lv.${b.lv + 1} · 이번 원정만` : '강화할 공 없음', upgrade: true, disabled: !b },
  ];
}
export function applyEventChoice(state, choice, maxHP) {
  if (choice.disabled || (choice.hpCost && state.heroHP <= choice.hpCost)) return false;
  state.gold += choice.gold || 0;
  state.heroHP += Math.min(choice.heal || 0, Math.max(0, maxHP - state.heroHP));
  state.heroHP -= choice.hpCost || 0;
  state.dmgMul += choice.damage || 0;
  state.riskMul += choice.risk || 0;
  if (choice.upgrade && state.inventory[0]) state.inventory[0].lv++;
  return true;
}

export const KNIGHTS = [
  { id: 'guardian', name: '수호 기사', short: '수호', color: 0xffcf79, desc: '철구 3개 시작 · 첫 피격 피해 1 방어', start: ['iron','iron','iron'], speed: 1, status: 1 },
  { id: 'ranger', name: '유성 기사', short: '유성', color: 0xf3b5dd, desc: '관통구+철구 2개 시작 · 공 속도 +20%', start: ['pierce','iron','iron'], speed: 1.2, status: 1, unlock: 'dungeon' },
  { id: 'alchemist', name: '연금 기사', short: '연금', color: 0x8ce5ab, desc: '독구+빙결구+철구 시작 · 독/빙결 지속시간 +30%', start: ['poison','ice','iron'], speed: 1, status: 1.3, unlock: 'ruins' },
];
export const knightOpen = (save, knight) => !knight.unlock || (save.clearedRegions || []).includes(knight.unlock);
export const selectedKnight = save => KNIGHTS.find(k => k.id === save.selectedKnight && knightOpen(save, k)) || KNIGHTS[0];
export const validKnight = value => value === undefined || KNIGHTS.some(k => k.id === value);

export const ROUTES = [
  { id: 'safe', name: '순찰로', desc: '기본 적과 보상 · 익숙한 원정', hp: 1, gold: 1 },
  { id: 'elite', name: '정예 습격', desc: '적 HP +35% · 4/7웨이브 중장갑 증원 · 적 골드 +50%', hp: 1.35, gold: 1.5 },
  { id: 'gilded', name: '황금 행렬', desc: '적 전진 +20% · 적 골드 2배', hp: 1, gold: 2, march: 1.2 },
];
export const selectedRoute = save => ROUTES.find(r => r.id === save.selectedRoute) || ROUTES[0];
export const validRoute = value => value === undefined || ROUTES.some(r => r.id === value);

export const RELICS = [
  { id: 'magnet', name: '청록 나침반', desc: '젬 자석 거리 2.6 → 4.2. 실제 수집 거리는 그대로.' },
  { id: 'ricochet', name: '메아리 인장', desc: '벽에 튕길 때마다 그 발사 공 직격 +1, 최대 +3. 회수하면 초기화.' },
  { id: 'ward', name: '호박 부적', desc: '보유 중 다음 피격 피해 1 방어. 원정당 한 번만.' },
  { id: 'haste', name: '시계 톱니', desc: '보유 중 발사 대기시간 15% 감소. 신속 사격과 별개.' },
  { id: 'bounty', name: '탐욕 주머니', desc: '적 처치 골드 +2. 조건 배율 계산 뒤 더함.' },
  { id: 'vampire', name: '진홍 성배', desc: '보유 중 적 5명 처치마다 HP +1. 성의 최대 HP까지.' },
];
export const validRelicProgress = value => value === undefined || (Array.isArray(value) && value.length <= RELICS.length && value.every(id => RELICS.some(r => r.id === id)) && new Set(value).size === value.length);
export const mergeDiscoveries = (save, found) => [...new Set([...(save.discoveredRelics || []), ...found])].filter(id => RELICS.some(r => r.id === id));
export function relicOptions(held, random = Math.random) {
  const pool = RELICS.filter(r => !held.includes(r.id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i],pool[j]] = [pool[j],pool[i]]; }
  return pool.slice(0, 3);
}
export const CONTRACTS = [
  { id: 'none', name: '계약 없음', desc: '조건 보상 없이 자유롭게 원정', goal: 0, reward: 0 },
  { id: 'slayer', name: '토벌 의뢰', desc: '이번 원정 적 10명 처치 · 골드 +35', goal: 10, reward: 35 },
  { id: 'collector', name: '보석 회수', desc: '이번 원정 젬 10개 회수 · 골드 +40', goal: 10, reward: 40 },
  { id: 'boss', name: '수문장 사냥', desc: '이번 지역 보스 처치 · 골드 +60', goal: 1, reward: 60 },
];
export const selectedContract = save => CONTRACTS.find(c => c.id === save.selectedContract) || CONTRACTS[0];
export const validContract = value => value === undefined || CONTRACTS.some(c => c.id === value);
export function contractProgress(contract, state) {
  const value = contract.id === 'slayer' ? state.kills : contract.id === 'collector' ? state.gemsGot : contract.id === 'boss' ? Number(state.victory) : 0;
  return { value: Math.min(contract.goal, value), complete: contract.goal > 0 && value >= contract.goal, reward: contract.goal > 0 && value >= contract.goal ? contract.reward : 0 };
}

// Enemy field guide: fixed encounters guarantee each mechanic appears in an expedition.
export const ENEMY_GUIDE = [
  { id: 'shield', name: '방패병', wave: 3, color: 0x6daeff, desc: '정면 직격을 1 줄입니다(최소 0). 뒤에서 튕겨 맞히거나 관통구로 우회하세요. 동결 중에는 방패가 내려갑니다. 상태 효과는 적용됩니다.' },
  { id: 'healer', name: '치유 사제', wave: 5, color: 0x80ffc4, desc: '4초마다 2칸 안의 다른 적 HP를 1 회복합니다. 최대 HP를 넘지 않습니다. 얼리면 회복 주기도 멈춥니다.' },
  { id: 'volatile', name: '폭발 운반병', wave: 7, color: 0xffa25b, desc: '처치하면 그 자리에 1.5초 예고 뒤 반경 1.1 폭발, 영웅 피해 1. 원 밖으로 피하세요. 접촉·경계 이탈 때는 폭발하지 않습니다.' },
];
export const specialEnemyAt = wave => ENEMY_GUIDE.find(e => e.wave === wave)?.id;
export const shieldDirect = (enemy, projectile, damage, piercing) => enemy.type === 'shield' && enemy.frozen <= 0 && !piercing && projectile.z > enemy.z ? Math.max(0, damage - 1) : damage;
