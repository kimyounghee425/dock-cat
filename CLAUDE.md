@.claude/rules/javascript.md
@.claude/rules/typescript.md

# DockCat — 레포 구조

macOS 화면 하단을 돌아다니는 픽셀 고양이 데스크톱 펫. Electron · electron-vite · React · TypeScript · XState.
투명·항상위·클릭통과 오버레이 창에 렌더하고, 고양이 픽셀만 마우스를 잡는다. 행동 로직은 에셋과 무관한 상태머신이라 스프라이트를 바꿔도 로직은 안 건드린다.

## 최상위

| 경로 | 역할 |
|------|------|
| `src/main/` | Electron **메인 프로세스** — 창/트레이/IPC/설정 저장 |
| `src/preload/` | 렌더러에 노출하는 **preload 브리지** |
| `src/renderer/` | **렌더러(React)** — UI + 펫 시뮬레이션 |
| `src/shared/` | 메인·렌더러 **공용 config 타입/상수** (`config.ts`) |
| `assets-raw/` | 가공 전 원본 에셋 / `docs/` 배포 사이트·스펙 / `dist`·`out`·`build` 빌드 산출물(수정 X) |

## `src/main/`

`index.ts`(앱 진입), `windows.ts`(오버레이/설정 창), `tray.ts`(메뉴바), `ipc.ts`(메인↔렌더 통신), `config-store.ts`(설정 영속화).

## `src/renderer/src/`

레이어가 폴더로 드러난다 — `ui/`(React가 그리는 것) vs `simulation/`(캔버스가 그리는 것).

- 루트: `main.tsx`(진입), `i18n.ts`(영/한), `env.d.ts`
- `ui/` — **React 레이어**: `App.tsx` · `PetStage.tsx`(React→시뮬 다리) · `SettingsPanel.tsx` · `styles.css`
- `simulation/` — **캔버스 시뮬 레이어** (아래 표). 에셋 정의(`cat.ts`)와 스프라이트(`assets/`)도 여기 소유.

### `src/renderer/src/simulation/` — 펫 시뮬레이션 코어 (리팩토링 주 대상)

React가 아니라 vanilla TS + Canvas로 동작한다 (React는 핫패스 밖). 순수 로직과 부수효과(DOM·시간·랜덤·engine)를 분리하는 게 이 디렉터리의 설계 원칙.

| 파일 | 역할 | 순수성 |
|------|------|--------|
| `world.ts` | 전체 오케스트레이터 — 고양이 인스턴스/먹이/포인터 이벤트를 묶는 **불순 껍데기** | 부수효과 O |
| `engine.ts` | `catMachine`을 돌리는 XState actor 위의 얇은 **facade** (매 프레임 읽기용 필드 미러링) | 부수효과 O |
| `catMachine.ts` | XState 상태머신 — "어떤 전이가 있는가" 소유 | — |
| `behaviors.ts` | 고양이 **행동 정책** 순수 함수 — "각 행동이 무엇을 계산하는가" (rng 호출 순서가 골든마스터 패리티에 묶임) | 순수 |
| `geometry.ts` | 포인터 기하/히트테스트 산술 | 순수 |
| `feeding-logic.ts` | 먹이 모임/최근접 배정 알고리즘 | 순수 |
| `gesture.ts` | 포인터 제스처 reducer (effects-as-data) | 순수 |
| `view.ts` | 스프라이트 시트 → 캔버스 렌더 어댑터 + 히트박스 노출 | 부수효과 O |
| `types.ts` | 펫 타입 정의 + shared config 재export | — |
| `cat.ts` | 고양이 에셋 정의(애니 레지스트리·스프라이트 시트 매핑) | — |
| `assets/` | 스프라이트 PNG (`cat-*.png`·`bowl.png`·`pellet.png`) | — |
| `*.test.ts`, `__fixtures__/` | vitest 단위 테스트 / 골든마스터 픽스처 | — |
