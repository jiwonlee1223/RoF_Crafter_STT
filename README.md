# 음성 기반 대화 에이전트 (RoF Crafter STT)

Deepgram과 OpenAI Whisper를 1:1 비교 테스트할 수 있는 음성 대화 에이전트 웹앱입니다.

## 주요 기능

- **TTS 기반 질문**: 시스템이 미리 정의된 질문을 음성으로 재생
- **STT 음성 응답**: 사용자 음성을 텍스트로 변환
- **엔진 비교**: Deepgram (실시간 스트리밍) / Whisper (배치) 토글 전환
- **메트릭 수집**: 지연시간, 신뢰도, 오디오 길이 측정
- **Firebase 연동**: 대화 기록(Firestore) + 마지막 응답 오디오(Storage) 저장

## 시작하기

### 1. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일에 API 키를 입력하세요:

- `DEEPGRAM_API_KEY` — [Deepgram Console](https://console.deepgram.com)에서 발급
- `OPENAI_API_KEY` — [OpenAI Platform](https://platform.openai.com)에서 발급
- Firebase 관련 설정 (선택사항 — 없으면 로컬 모드로 동작)

### 2. 의존성 설치

```bash
npm install
```

### 3. 서버 실행

```bash
npm start
```

브라우저에서 `http://localhost:3001` 접속

### 4. 개발 모드 (자동 재시작)

```bash
npm run dev
```

## 프로젝트 구조

```
├── client/
│   ├── index.html         # 메인 UI
│   ├── app.js             # WebSocket, 마이크, TTS, UI 로직
│   └── style.css          # 스타일
├── server/
│   ├── index.js           # Express + WebSocket 서버
│   ├── deepgramHandler.js # Deepgram 실시간 STT 프록시
│   ├── whisperHandler.js  # Whisper 배치 STT
│   ├── sessionManager.js  # 대화 세션 관리
│   ├── firebaseService.js # Firebase 연동
│   └── questions.json     # 질문 목록
├── .env.example
└── package.json
```

## 사용법

1. STT 엔진을 선택합니다 (Deepgram 또는 Whisper)
2. 시스템이 질문을 음성으로 재생합니다
3. 마이크 버튼을 클릭하여 응답합니다
4. 응답이 끝나면 다시 마이크 버튼을 눌러 녹음을 종료합니다
5. STT 결과와 메트릭이 표시됩니다
6. 모든 질문이 끝나면 대화 기록이 Firebase에 저장됩니다
