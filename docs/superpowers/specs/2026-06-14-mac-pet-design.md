# mac-pet — 데스크탑 펫 (디자인 스펙)

작성일: 2026-06-14

## 목표
macOS 화면 위에 귀여운 도트(픽셀) 고양이를 띄워, 화면 바닥에서 자유롭게
돌아다니게 하는 눈요기용 데스크탑 펫 앱. 클릭하면 반응(움찔/점프)한다.
향후 강아지 등 동물을 여러 마리 추가할 수 있도록 동물 단위로 모듈화한다.

## 스택
- Electron + electron-vite + React + TypeScript
- 패키지 매니저: pnpm
- 단일 패키지 (모노레포 아님). Electron 표준 main / preload / renderer 분리.
- 배포: 최종적으로 electron-builder로 .app/.dmg 패키징(후속 단계). MVP는 `pnpm dev`로 검증.

## 핵심 설계 원칙 — 3층 분리 (에셋 교체 시 동작 코드 불변)
1. **행동 엔진 (state machine)** — 에셋을 전혀 모름. 상태/전환/타이머만 다룸. 절대 안 바뀜.
2. **렌더 어댑터 (view)** — 현재 상태/프레임을 화면에 그림. 목업(SVG/CSS) → 스프라이트 시트로
   교체할 때 여기만 손봄.
3. **펫 정의 (pets/cat.ts)** — 동물 단위 데이터: 상태 목록, 에셋 경로, 프레임 수, fps, 히트박스.
   새 동물 = 새 파일 1개.

목업 SVG → 무료 스프라이트 교체 시: 행동 엔진은 무수정, 펫 정의 + 렌더 어댑터만 교체.

## 창 (main process)
- 전체화면 투명 / 프레임 없음 / 항상 위(screen-saver 레벨) / 그림자 없음 / 리사이즈 불가
- 모든 Space + 전체화면 앱 위에서도 보이게 (`setVisibleOnAllWorkspaces`)
- 기본 `setIgnoreMouseEvents(true, { forward: true })` → 화면 전체 클릭 통과
- 마우스가 **고양이 히트박스 위에 올라올 때만** IPC로 클릭 캡처 전환 → 고양이만 클릭됨
- MVP는 주 디스플레이 1개 기준 (멀티모니터는 후속)
- 종료 UX: MVP는 dock 아이콘 유지로 Cmd+Q. 트레이 메뉴는 후속.

## 행동 (MVP 4종)
- **walk**: 바닥에서 좌우 이동, 진행 방향에 따라 좌우 반전, 화면 경계에서 방향 전환
- **idle**: 가만히 + 미세한 숨쉬기/까딱
- **react**: 클릭 시 움찔·점프 (~600ms) 후 idle 복귀
- **sleep**: 일정 시간(기본 30초) 무상호작용 시 잠듦. 클릭하면 깸. 잘 땐 렌더 최소화로 CPU ~0%

상태 전환:
- idle ↔ walk: 랜덤 시간으로 전환
- 무활동 타이머 만료 → sleep
- 클릭 → react (타이머 리셋, 자고 있었으면 깸) → idle

## 성능
- `requestAnimationFrame` 단일 루프, dt 기반 갱신
- sleep/정지 상태에서는 그리기 작업 스킵 (유휴 CPU 최소화)
- 위치 이동은 GPU 합성(transform) 사용

## 폴더 구조
```
mac-pet/
├─ electron.vite.config.ts
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ main/index.ts          # 투명창 생성 + 클릭통과 IPC 처리
   ├─ preload/index.ts       # contextBridge IPC 브릿지
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ main.tsx          # React 마운트
         ├─ App.tsx           # (후속) 설정/메뉴 UI 자리
         ├─ PetStage.tsx      # 펫 엔진 마운트 지점 (ref 제공)
         ├─ styles.css
         ├─ pet/
         │  ├─ engine.ts      # 상태머신 (에셋 무관)
         │  ├─ locomotion.ts  # 이동·반전·경계
         │  ├─ loop.ts        # requestAnimationFrame 루프 + 엔진 결합
         │  └─ view.ts        # 스프라이트 그리기 (교체 어댑터)
         └─ pets/
            └─ cat.ts         # 동물 단위 정의 (상태·에셋·히트박스)
```

렌더링 루프는 React 밖에서 명령형으로 동작(매 프레임 React 리렌더 없음). React는 부속
UI(설정/펫 선택)용으로만 사용.

## 후속 (MVP 이후)
- 무료 스프라이트 시트로 에셋 교체
- 강아지 등 동물 추가 (`pets/dog.ts`)
- 트레이 메뉴, 설정 창, 멀티모니터, electron-builder 패키징
- 추가 행동(마우스 피하기, 알림 반응 등)
