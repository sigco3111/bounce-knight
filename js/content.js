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
