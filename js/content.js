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
