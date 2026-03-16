# RoF Crafter STT

음성 기반 대화 에이전트 웹앱입니다. Deepgram 실시간 STT, OpenAI GPT 에이전트, Firebase 인증/저장, ComfyUI 비디오 생성까지 한 흐름으로 테스트할 수 있습니다.

---

## 목차

- [기술 스택](#기술-스택)
- [사전 요구사항](#사전-요구사항)
- [설치 및 실행](#설치-및-실행)
- [환경 변수](#환경-변수)
- [테스트 시나리오](#테스트-시나리오)
- [API 및 WebSocket](#api-및-websocket)
- [문제 해결](#문제-해결)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트 | HTML/CSS/JS, WebSocket, MediaRecorder, getUserMedia |
| 백엔드 | Node.js, Express, WebSocket(ws) |
| STT | Deepgram Live (nova-2, 한국어) |
| 에이전트 | OpenAI GPT-4o |
| 인증/DB | Firebase (Firestore, Storage) |
| 비디오 | ComfyUI 워크플로우, Gemini 이미지 전처리 |

---

## 사전 요구사항

- **Node.js** 18+ (권장: 20+)
- **npm** 또는 **yarn**
- 다음 서비스 계정/키 준비:
  - Deepgram API 키
  - OpenAI API 키
  - Firebase 프로젝트 + 서비스 계정 JSON
  - (선택) Gemini API 키 — 비디오 생성 시 이미지 전처리
  - (선택) ComfyUI 서버 — 비디오 생성용

---

## 설치 및 실행

### 1. 저장소 클론 및 의존성 설치

```bash
cd RoF_Crafter_STT
npm install
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 만들고 [환경 변수](#환경-변수) 섹션을 참고해 필요한 값을 채웁니다.

```bash
cp .env.example .env
# .env 파일을 열어 API 키 등을 입력
```

Firebase를 사용할 경우 `serviceAccountKey.json`을 프로젝트 루트 또는 `FIREBASE_SERVICE_ACCOUNT_PATH`에 지정한 경로에 두세요.

### 3. 서버 실행

```bash
# 프로덕션
npm start

# 개발 (파일 변경 시 자동 재시작)
npm run dev
```

서버가 뜨면 브라우저에서 `http://localhost:3000` (또는 `PORT`에 설정한 주소)로 접속합니다.

---

## 환경 변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `PORT` | 아니오 | 서버 포트 (기본값: 3000) |
| `DEEPGRAM_API_KEY` | 예* | Deepgram 실시간 STT용 API 키 |
| `OPENAI_API_KEY` | 예* | GPT 에이전트용 API 키 |
| `FIREBASE_PROJECT_ID` | 비디오/저장 시 | Firebase 프로젝트 ID |
| `FIREBASE_STORAGE_BUCKET` | 비디오/저장 시 | Storage 버킷 (예: `프로젝트.firebasestorage.app`) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase 사용 시 | 서비스 계정 JSON 파일 경로 (예: `./serviceAccountKey.json`) |
| `GEMINI_API_KEY` | 비디오 생성 시 | Gemini 이미지 전처리용 |
| `GEMINI_MODEL` | 비디오 생성 시 | 사용할 Gemini 모델 (예: `gemini-3.1-flash-image-preview`) |
| `COMFYUI_HOST` | 비디오 생성 시 | ComfyUI HTTP 주소 |
| `COMFYUI_WS` | 비디오 생성 시 | ComfyUI WebSocket 주소 |
| `COMFYUI_UPLOAD_SERVER` | 비디오 생성 시 | 이미지 업로드용 서버 URL |
| `COMFYUI_VIDEO_HOST` | 비디오 생성 시 | 생성된 비디오 호스트 URL |

\* STT/에이전트 없이 UI만 확인하려면 키 없이 실행 가능하나, 음성 인식 및 다음 질문 생성은 동작하지 않습니다.

---

## 테스트 시나리오

### 1. 로그인/회원가입

- **회원가입**: 아이디 2자 이상, 비밀번호 4자 이상으로 가입 후 로그인 가능한지 확인.
- **로그인**: 가입한 아이디/비밀번호로 로그인 시 메인 화면으로 이동하는지 확인.

### 2. 프로필(이름/성별/생년월일)

- 로그인 후 프로필 화면에서 **이름**, **생년월일·시간**, **성별** 입력 가능한지 확인.
- 이 값들은 WebSocket 연결 시 쿼리 파라미터(`userName`, `birthDateTime`, `gender`)로 전달되며, 에이전트 인사/질문과 페르소나 생성에 사용됩니다.

### 3. 대화 플로우(질문 수)

- 질문 개수는 `server/questions.json`의 `questions` 배열 길이로 결정됩니다.
- 기본 예시:
  1. 인사 + "이름이 뭐니?"
  2. "생년월일이 어떻게 되니?"
  3. "최근 일상을 알려줘."
- **테스트 포인트**:
  - 첫 연결 시 에이전트 인사 메시지가 한 번 오는지.
  - 사용자가 음성/텍스트로 답한 뒤 **답변 저장** 시 다음 질문이 오는지.
  - 진행률(턴/최대 턴)이 올바르게 증가하는지.
  - 마지막 질문까지 답한 뒤 세션 완료·저장이 되는지.

### 4. 음성 인식(STT)

- **마이크 권한**: 최초 "시작" 또는 녹음 버튼 클릭 시 브라우저 마이크 권한 허용 여부 확인.
- **녹음 → 중지**:
  - 녹음 중 실시간(interim) 인식 결과가 화면에 표시되는지.
  - 중지 후 최종(partial_final) 결과가 한 번 더 오고, "답변 저장" 시 해당 텍스트가 대화에 반영되는지.
- **허위 인식(할루시네이션)**: "시청해주셔서 감사합니다", "구독과 좋아요" 등 특정 문구가 최종 결과에만 포함된 경우 서버에서 `transcript_rejected`로 거부하고, 클라이언트에서 다시 녹음 유도하는지 확인 (서버 로그 `[REC] Empty or hallucinated transcript` 참고).

### 5. 메트릭(지연시간/신뢰도/녹음 길이)

- **STT 지연시간(latency_ms)**, **신뢰도(confidence)**, **녹음 길이(audio_duration_sec)** 가 UI 메트릭 패널에 표시되는지 확인.
- 값은 `save_answer` 시 서버로 전달되어 세션 턴 메타데이터에 저장됩니다.

### 6. 세션 종료 및 저장

- **모든 질문 완료** 시 자동으로 세션 완료 처리되는지.
- **"세션 종료"** 버튼으로 조기 종료 시에도 완료 플로우가 동작하는지.
- 로그인한 사용자: Firebase `responses/{userId}/default/data`에 대화가 저장되는지, Storage에 녹음 음원이 올라가는지 확인.
- 익명 사용자: `sessionId` 기준으로 저장되는지 확인.

### 7. 비디오 생성(선택)

- ComfyUI·Gemini 설정이 되어 있을 때:
  - 이미지 파일 선택 후 **비디오 생성** 요청.
  - 전처리(preprocessing) → 업로드(uploading) → 생성(generating) 단계별 상태 메시지/프로그레스가 오는지.
  - 완료 시 speaking/listening 비디오 URL이 표시되고, Firebase에 저장되는지 확인.

### 8. 페르소나 생성

- 세션 완료 후 백그라운드에서 `agentService.generateExhibPersona`가 호출되어 대화 이력과 생년월일로 페르소나/카드 텍스트가 생성되고 Firebase에 저장되는지 서버 로그 `[PERSONA]`로 확인.

---

## API 및 WebSocket

### REST

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/register` | 회원가입. Body: `{ userId, password }` |
| POST | `/api/login` | 로그인. Body: `{ userId, password }` |
| POST | `/upload-voice` | 음성 파일 업로드. `multipart/form-data`: `voice`, `userId` |
| GET | `/api/session/:sessionId` | 세션 JSON 조회 (디버깅용) |

### WebSocket 연결

- URL: `ws://localhost:PORT?userId=...&userName=...&gender=...&birthDateTime=...`
- 쿼리 파라미터는 선택 사항이며, 로그인/프로필 정보를 넘길 때 사용합니다.

### WebSocket 메시지 (클라이언트 → 서버)

| type | 설명 |
|------|------|
| `start_recording` | 녹음 시작. 이후 바이너리 프레임은 PCM 오디오 청크 |
| `stop_recording` | 녹음 중지 |
| `save_answer` | 현재 인식 결과를 사용자 답변으로 확정. Optional: `text`, `latency_ms`, `confidence`, `audio_duration_sec` |
| `end_session` | 세션 조기 종료 |
| `generate_video` | 비디오 생성. payload: `userId`, `gender`, `fileBuffer`, `speakingPrompt`, `listeningPrompt` |

### WebSocket 메시지 (서버 → 클라이언트)

| type | 설명 |
|------|------|
| `session_start` | 세션 ID, 첫 질문(인사), turn/max_turns |
| `transcript_interim` | 실시간 인식 중간 결과 |
| `transcript_partial_final` | 구/문장 단위 최종 결과 |
| `transcript_final` | 녹음 중지 후 최종 전문 (저장 대상) |
| `transcript_rejected` | 빈 문자열 또는 할루시네이션으로 거부됨 |
| `agent_thinking` | 다음 질문 생성 중 |
| `next_question` | 에이전트 다음 질문, turn/max_turns |
| `session_complete` | 세션 완료, 전체 session 객체 |
| `video_status` | status: `preprocessing` / `uploading` / `generating` |
| `video_progress` | finished, total 노드 진행률 |
| `video_complete` | speakingUrl, listeningUrl |
| `error` | 에러 메시지 |

---

## 문제 해결

### 서버가 시작되지 않음

- `npm install`이 완료되었는지 확인.
- `PORT`가 이미 사용 중이면 `.env`에서 다른 포트로 변경.
- Firebase 사용 시 `FIREBASE_SERVICE_ACCOUNT_PATH` 경로와 JSON 내용이 올바른지 확인.

### "[DEEPGRAM] API key not set" / "[AGENT] OpenAI API key not set"

- `.env`에 `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`가 설정되어 있는지 확인.
- 서버 재시작 후 로그에 `[DEEPGRAM] Client initialized`, `[AGENT] OpenAI client initialized`가 찍히는지 확인.

### 음성이 인식되지 않음

- 브라우저 마이크 권한이 허용되어 있는지 확인.
- HTTPS가 필요한 환경에서는 로컬이 아니라면 `https` 및 `wss` 사용 필요.
- Deepgram Live는 16kHz linear16 PCM을 기대하므로, 클라이언트가 올바른 포맷으로 전송하는지 확인 (현재 클라이언트는 해당 포맷으로 설정됨).

### "transcript_rejected"가 자주 뜸

- 서버의 `HALLUCINATION_PATTERNS`에 포함된 문구가 최종 결과에만 있을 때 거부됩니다. 짧은 말이나 배경 소음이 해당 패턴으로 인식될 수 있으니, 테스트 시 명확하게 말하거나 패턴 목록을 조정해 볼 수 있습니다.

### 비디오 생성 실패

- `COMFYUI_*` 환경 변수와 ComfyUI 서버 상태 확인.
- `GEMINI_API_KEY`가 있으면 이미지 전처리 후 ComfyUI로 전달되며, Gemini 실패 시 원본 이미지로 진행됩니다. 네트워크 및 API 할당량을 확인하세요.

### Firebase 권한 오류

- 서비스 계정에 Firestore 및 Storage 권한이 있는지 확인.
- `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`이 프로젝트와 일치하는지 확인.

---

## 프로젝트 구조 (요약)

```
RoF_Crafter_STT/
├── client/           # 정적 웹 클라이언트
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/
│   ├── index.js      # Express + WebSocket 진입점
│   ├── agentService.js
│   ├── deepgramHandler.js
│   ├── sessionManager.js
│   ├── firebaseService.js
│   ├── comfyuiService.js
│   ├── gemini-image-gen.js
│   └── questions.json  # 대화 질문 목록 (순서대로 사용)
├── .env              # 환경 변수
├── package.json
└── README.md
```

---

이 문서는 앱을 로컬에서 실행하고 위 시나리오대로 동작을 검증하는 데 필요한 내용을 담고 있습니다. 추가로 테스트하고 싶은 시나리오가 있으면 `questions.json` 수정과 서버 로그(`[FLOW]`, `[REC]`, `[AGENT]`, `[SESSION]` 등)를 함께 보면 디버깅에 도움이 됩니다.
