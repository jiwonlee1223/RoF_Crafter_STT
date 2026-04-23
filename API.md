# RoF Crafter STT — API 엔드포인트 문서

서버: `http://localhost:3001` (기본 포트)

---

## REST API

### 인증

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/register` | 신규 사용자 등록 |
| POST | `/api/login` | 기존 사용자 로그인 |

**요청 Body (공통)**

```json
{
  "userId": "홍길동",
  "password": "990101",
  "gender": "female"
}
```

- `userId` — 이름 (2자 이상)
- `password` — 생년월일 6자리
- `gender` — `female` / `male` / `neutral` (선택)

등록/로그인 성공 시 `visitLogs` 컬렉션에 방문 기록이 자동 저장됩니다.

---

### 데이터 다운로드

#### 방문 기록

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/visits` | 전체 방문 기록 (JSON) |
| GET | `/api/visits?format=csv` | CSV 파일 다운로드 |

**날짜 필터 (선택)**

| 파라미터 | 형식 | 예시 |
|----------|------|------|
| `from` | `YYYY-MM-DD` | `2026-04-01` |
| `to` | `YYYY-MM-DD` | `2026-04-24` |

예시:
```
/api/visits?from=2026-04-20&to=2026-04-24
/api/visits?from=2026-04-20&to=2026-04-24&format=csv
/api/visits?from=2026-04-24          ← 오늘 하루만
```

**응답 필드**

| 필드 | 설명 |
|------|------|
| `userId` | 사용자 ID (`이름_생년월일`) |
| `name` | 이름 |
| `birth` | 생년월일 6자리 |
| `gender` | 성별 |
| `visitedAt` | 방문 일시 (ISO 8601) |

> 같은 사람이 여러 번 로그인하면 매번 별도 기록으로 쌓입니다.

---

#### 연락처 (추가 인터뷰 의향자)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/contacts` | 전체 연락처 (JSON) |
| GET | `/api/contacts?format=csv` | CSV 파일 다운로드 |

**날짜 필터** — `from`, `to` 파라미터 동일하게 사용 가능

예시:
```
/api/contacts?format=csv
/api/contacts?from=2026-04-20&format=csv
```

**응답 필드**

| 필드 | 설명 |
|------|------|
| `userId` | 사용자 ID |
| `phone` | 전화번호 |
| `email` | 이메일 |
| `createdAt` | 제출 일시 (ISO 8601) |

---

### 기타

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/session/:sessionId` | 특정 세션의 대화 데이터 조회 |
| GET | `/api/voice/:userId` | 저장된 음성(WAV) 스트리밍 재생 |
| POST | `/upload-voice` | 음성 파일 업로드 (multipart) |
| POST | `/api/tts` | 텍스트 → 음성 변환 (ElevenLabs TTS) |

---

## WebSocket

접속: `ws://localhost:3001?userId=...&userName=...&gender=...&birthDateTime=...`

### 클라이언트 → 서버

| type | 설명 | 추가 필드 |
|------|------|-----------|
| `start_recording` | 녹음 시작 | — |
| `stop_recording` | 녹음 종료 → STT 전사 요청 | — |
| `save_answer` | 사용자 답변 저장 | `text`, `latency_ms`, `confidence`, `audio_duration_sec` |
| `end_session` | 대화 세션 종료 | — |
| `save_contact` | 추가 인터뷰 연락처 저장 | `phone`, `email` |
| `generate_video` | 비디오 생성 요청 | `userId`, `gender`, `fileBuffer` |
| *(binary)* | 녹음 중 PCM 오디오 청크 | — |

### 서버 → 클라이언트

| type | 설명 | 주요 필드 |
|------|------|-----------|
| `session_start` | 세션 시작 + 첫 질문 | `session_id`, `question`, `turn`, `max_turns` |
| `transcript_interim` | STT 중간 전사 | `text`, `full_text` |
| `transcript_partial_final` | STT 부분 확정 | `text`, `full_text` |
| `transcript_final` | STT 최종 전사 | `text`, `confidence`, `audio_duration_sec` |
| `transcript_rejected` | 전사 실패/빈 응답 | — |
| `agent_thinking` | 에이전트 응답 생성 중 | — |
| `next_question` | 다음 질문 | `question`, `turn`, `max_turns` |
| `closing_remark` | 마무리 멘트 | `question` |
| `session_complete` | 세션 종료 완료 | `session` |
| `conversation_summary` | 대화 요약 텍스트 | `text` |
| `persona_ready` | 페르소나 생성 완료 | — |
| `contact_saved` | 연락처 저장 완료 | — |
| `video_status` | 비디오 생성 진행 상태 | `status` (`preprocessing`/`uploading`/`generating`) |
| `video_progress` | 비디오 생성 진행률 | `finished`, `total` |
| `video_complete` | 비디오 생성 완료 | `speakingUrl`, `listeningUrl` |
| `future_scenes_complete` | 미래 장면 이미지 생성 완료 | `scenes` |
| `error` | 에러 | `message` |

---

## Firestore 컬렉션 구조

```
├── users/{userId}                          ← 계정 (password, createdAt)
├── visitLogs/{auto-id}                     ← 방문 기록 (매 로그인마다 1건)
├── contactInfo/{userId}                    ← 추가 인터뷰 연락처
├── responses/{userId}/
│   ├── default/data                        ← 대화 세션 데이터
│   └── exhibPersona/
│       ├── data                            ← 전시용 페르소나 텍스트
│       ├── card                            ← 페르소나 카드
│       └── vars                            ← 페르소나 변수
├── chatHistory/{sessionId}                 ← 채팅 메타 (턴 수 등)
├── generatedVideos/{userId}                ← 생성된 비디오 URL
├── voice/{userId}                          ← 음성 녹음 메타 + Storage URL
└── photo_test/{userId}                     ← 미래 장면 이미지 메타
```

Storage:
```
├── voice/{userId}.wav                      ← 음성 WAV 파일
├── sessions/{sessionId}/last_answer.webm   ← 세션 오디오
└── photo_test/{userId}/*.png               ← 미래 장면 이미지 파일
```
