# PRD: 모바일 우선 Web Terminal Viewer (xterm + node-pty)

## 1) 제품 개요
- **제품명(가칭)**: Clily Terminal Viewer
- **목표**: iPhone/iPad에서 웹으로 서버 터미널을 안정적으로 조회/제어할 수 있는 모바일 우선 터미널 앱 제공
- **핵심 기술**: `xterm.js`(프론트), `node-pty`(백엔드 PTY), SSE 출력 + HTTP POST 입력 브릿지

## 2) 문제 정의
- 모바일에서 서버 터미널 접근 시 입력 불편(특수키, 조합키)이 큼.
- 브라우저 연결이 끊길 때 터미널 프로세스가 함께 종료되면 작업 연속성이 깨짐.

## 3) 제품 목표 / 비목표
### 목표
1. 서버 프로세스 생명주기 동안 단일 PTY를 유지한다.
2. 브라우저 재접속 시 같은 터미널 상태를 이어서 본다(backlog replay).
3. 모바일 친화 입력 UX(화살표, Ctrl+C, Tab, Esc)
4. 무한 스크롤(긴 로그 조회) 가능한 터미널 뷰
5. 추후 PWA 전환 및 알림 기능 확장을 고려한 구조

### 비목표(1차)
- 완전한 IDE 기능(파일 트리, 디버거 등)
- 멀티 유저 협업 기능
- tmux 세션/윈도우 관리 UI

## 4) 대상 사용자
- iPhone/iPad 중심으로 원격 터미널을 자주 확인하는 개발자/운영자

## 5) 사용자 시나리오
1. 사용자가 웹 앱 접속
2. 앱이 Persistent Terminal에 attach
3. 기존 출력 backlog를 받아 최근 상태를 확인
4. 하단 채팅형 입력창에 명령 입력 후 Enter로 터미널 전송
5. 모바일 단축키 버튼으로 특수 입력 전송
6. 브라우저 종료 후 재접속해도 동일 터미널 계속 사용

## 6) 기능 요구사항 (Functional Requirements)

### FR-1. 터미널 연결 및 렌더링
- xterm.js를 사용해 웹 터미널 렌더링
- node-pty로 서버 측 PTY 프로세스 생성/중계
- 입력/출력은 실시간 양방향 스트리밍

### FR-2. Persistent Terminal
- 서버 시작 시 PTY를 1회 생성
- 클라이언트 연결/해제는 attach/detach만 수행
- 서버 종료 시에만 PTY 종료

### FR-3. 출력 backlog replay
- 최근 출력 backlog(ring buffer)를 유지
- 신규 클라이언트 접속 시 backlog replay

### FR-4. 뷰잉 모드 입력 UX
- 하단 입력창 제공
- Enter 입력 시 텍스트를 터미널로 전송
- 모바일에서 쉽게 누를 수 있는 특수키 버튼 제공:
  - Arrow Up/Down/Left/Right
  - Ctrl+C
  - Tab
  - Esc

### FR-5. 스크롤/버퍼
- 긴 출력 조회 가능한 충분한 scrollback(사실상 무한에 가까운 정책)
- 성능 저하를 고려해 상한값 기반 “실사용상 무한” 버퍼 정책 채택

## 7) 비기능 요구사항 (Non-Functional Requirements)

### NFR-1. 모바일 최적화
- iPhone Safari, iPad Safari 우선 지원
- 터치 타겟 최소 44px 기준
- 소프트 키보드 열림/닫힘 시 레이아웃 안정성 확보

### NFR-2. 성능
- 초기 접속 후 터미널 표시 지연 최소화
- 긴 로그 스트림에서도 입력 지연 체감 최소화

### NFR-3. 안정성
- 브라우저 연결이 끊겨도 서버 PTY는 유지
- 네트워크 단절 후 재연결 시 backlog replay로 연속성 제공

### NFR-4. 보안
- 서버 명령 실행 경로는 인증된 사용자 세션에 한정
- 터미널 I/O 채널 보호(예: WSS)
- 민감 정보 로깅 최소화

## 8) 정보 구조 / UI 구성
- **중앙 영역**: xterm 터미널 뷰포트(스크롤 가능)
- **하단 영역**: 입력창 + 모바일 특수키 바

## 9) 상태 전이(요약)
1. `INIT`
2. `PTY_CREATED`
3. `CLIENT_ATTACH`
4. `STREAMING`
5. `CLIENT_DETACH`

## 10) 엣지 케이스
- PTY 생성 실패
- 대량 출력 시 backlog 상한 초과
- 모바일 키보드로 인한 viewport 높이 급변

## 11) 향후 확장 (PWA/알림 대비)
- PWA 전환을 고려한 구조 분리(UI, 터미널 세션, 입력 제어)
- 사용자 입력이 필요한 상태 감지 훅 설계(예: 프롬프트 패턴 감지)
- 추후 Web Push/로컬 알림 연계를 위한 이벤트 인터페이스 정의

## 12) 수용 기준 (Acceptance Criteria)
1. 브라우저 재접속 후에도 같은 터미널 세션이 유지된다.
2. 신규 연결 시 최근 출력 backlog가 재표시된다.
3. 하단 입력창 Enter 전송이 동작한다.
4. 모바일 특수키(화살표/Ctrl+C/Tab/Esc)가 iPhone/iPad에서 사용 가능하다.
5. 긴 터미널 출력에서도 스크롤 조회가 가능하다.
6. 전체 UI가 모바일 화면에서 사용 가능하고 터치 친화적이다.
