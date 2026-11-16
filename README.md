# bounce-knight (working title / 임시 작업명)

모바일 우선 3D 공 튕기기 로그라이트 (BALL x PIT 스타일 오마주, 오리지널 구현).

기사를 움직여 조준하고, 자동 발사되는 공을 튕겨 행진하는 적을 무찌르세요.
처치 → XP 젬 수집 → 레벨업 4장 중 하나 선택(새 속성 공 2장 / 강화 또는 융합 1장 / 패시브 1장) → 기지 건물 업그레이드로 성장.

## 플레이
- 왼쪽 절반 드래그: 이동 / 오른쪽 절반 드래그: 조준 (공은 자동 발사)
- 기지: 성(영웅 HP), 대장간(공 직격 피해량), 주점(출격 공 수) 업그레이드
- 진행은 브라우저 localStorage에 저장됩니다 (이 배포 origin 기준).

## 로컬 실행
정적 파일만 있습니다. 아무 정적 서버나 루트에서 서빙하세요:
`python3 -m http.server` → http://localhost:8000

## 사용 에셋 / 라이선스
- 코드: MIT (이 저장소)
- KayKit 3D assets (kaylousberg.itch.io) — CC0
- plinkfx (github.com/sigco3111/plinkfx) — 코드 MIT, 사운드 CC0 (합성 효과음으로 대체 사용)
- three.js — MIT

제목은 아직 임시 작업명입니다.
