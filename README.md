# Clily Terminal Viewer

모바일(iPhone/iPad)에서 웹으로 터미널을 보고 조작하기 위한 앱입니다.

- 프론트: Next.js + xterm
- 백엔드 터미널: node-pty + SSE/HTTP API
- 서버 프로세스 생명주기 동안 단일 Persistent Terminal 유지

## 주요 기능

- 단일 Persistent Terminal
  - 서버 시작 후 첫 요청 시 PTY 1개 생성
  - 브라우저 연결/해제와 무관하게 동일 터미널 유지
- 출력 backlog replay
  - 재접속 시 최근 출력 자동 복원
- 입력 전송 분리
  - 일반 입력: `POST /api/terminal/input/text`
  - 특수키 입력: `POST /api/terminal/input/special`
  - 리사이즈: `POST /api/terminal/resize`
- 출력 스트리밍
  - `GET /api/terminal/stream` (SSE)
- 모바일 특수키
  - Arrow, Ctrl+C, Tab, Esc
- 긴 로그 스크롤 대응
  - 큰 scrollback 버퍼 사용

## 빠른 시작

### 1) 의존성 설치

```bash
npm install
```

### 2) 환경변수 파일 준비

`.env.example`를 복사해 `.env`를 만드세요.

```bash
cp .env.example .env
```

기본값:

```env
PORT=3001
```

- `PORT`: Next 개발 서버 포트
- (선택) `TERMINAL_E2E_MODE=mock`: E2E용 mock terminal 사용
- (선택) `TERMINAL_BACKLOG_MAX_CHARS`: backlog 최대 길이 조정

### 3) 실행

```bash
npm run dev
```

브라우저 접속:

- `http://localhost:3001` (또는 `.env`의 `PORT` 값)

## 사용 방법

1. 페이지 접속 후 터미널 연결을 기다립니다.
2. 하단 입력창에 명령을 입력하고 Enter로 실행합니다.
3. 모바일 특수키 바에서 화살표/Ctrl+C/Tab/Esc를 눌러 입력합니다.
4. 브라우저를 닫았다가 다시 접속해도 같은 서버 터미널을 계속 사용합니다.

## 테스트/검증

```bash
npm test
npm run typecheck
npm run lint
```

### E2E (Playwright)

최초 1회 브라우저 설치:

```bash
npx playwright install --with-deps
```

E2E 실행:

```bash
npm run test:e2e
```

UI 모드 실행:

```bash
npm run test:e2e:ui
```

참고:
- Playwright는 테스트 시 `TERMINAL_E2E_MODE=mock`로 서버를 띄워 결정론적으로 검증합니다.
- 웹 포트는 테스트에서 `3100`을 사용합니다.
- 모바일 E2E(iPhone/iPad)는 WebKit 런타임 이슈를 피하기 위해 Chromium 모바일 에뮬레이션으로 검증합니다.

## 문제 해결

### 디버그 로그 켜기

원인 파악이 필요하면 `.env`에 아래를 추가하세요.

```env
TERMINAL_DEBUG=1
NEXT_PUBLIC_TERMINAL_DEBUG=1
```

- `TERMINAL_DEBUG=1`: 서버(PTY/runtime) 로그 출력
- `NEXT_PUBLIC_TERMINAL_DEBUG=1`: 브라우저 콘솔에 클라이언트 SSE 로그 출력

### 터미널에 실행 실패 메시지가 표시됨

현재 실행 환경에서 `node-pty`가 PTY 생성에 실패한 상황입니다.

- 로컬 터미널에서 실행 중인지 확인
- macOS/Linux에서 셸 실행 환경/권한 점검

## 현재 범위 (MVP)

- DB/영구 저장소 없음
- 모바일 우선 뷰잉/명령 입력 UX 중심
- 추후 PWA/알림 기능 확장 예정
