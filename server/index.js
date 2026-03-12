require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const url = require('url');

const deepgramHandler = require('./deepgramHandler');
const whisperHandler = require('./whisperHandler');
const sessionManager = require('./sessionManager');
const firebaseService = require('./firebaseService');
const questions = require('./questions.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

const HALLUCINATION_PATTERNS = [
  '시청해주셔서 감사합니다',
  '시청해 주셔서 감사합니다',
  '구독과 좋아요',
  '좋아요와 구독',
  '다음 영상에서 만나요',
  '다음 영상에서 뵙겠습니다',
  'MBC 뉴스',
  'KBS 뉴스',
  'SBS 뉴스',
  '지금까지',
  '감사합니다 감사합니다',
  'Thank you for watching',
  'Please subscribe',
];

function isHallucination(text) {
  if (!text || text.trim().length === 0) return true;
  const normalized = text.trim();
  return HALLUCINATION_PATTERNS.some(p => normalized.includes(p));
}

// 초기화
deepgramHandler.init();
whisperHandler.init();
firebaseService.init();

// 정적 파일 서빙 (클라이언트)
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// 질문 목록 API
app.get('/api/questions', (req, res) => {
  res.json(questions);
});

// 대화 기록 조회 API
app.get('/api/session/:sessionId', (req, res) => {
  const data = sessionManager.toJSON(req.params.sessionId);
  if (!data) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
  res.json(data);
});

// WebSocket 연결 처리
wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const engine = params.engine || 'deepgram';

  const session = sessionManager.createSession(engine);
  const sessionId = session.session_id;

  console.log(`[WS] New session: ${sessionId}, engine: ${engine}`);

  let dgSession = null;
  let audioStartTime = null;
  let finalTranscript = '';
  let lastConfidence = 0;
  let lastLatency = 0;
  let transcriptSent = false;
  let whisperAudioBuffer = null;

  // Deepgram 모드: 실시간 세션 생성
  if (engine === 'deepgram') {
    dgSession = deepgramHandler.createLiveSession(
      (text, isFinal, confidence, latency, isUtteranceEnd) => {
        if (isUtteranceEnd) {
          if (transcriptSent) return;
          if (finalTranscript && !isHallucination(finalTranscript)) {
            transcriptSent = true;
            ws.send(JSON.stringify({
              type: 'transcript_final',
              text: finalTranscript,
              confidence: lastConfidence,
              latency_ms: lastLatency,
            }));
          } else if (finalTranscript) {
            console.log(`[DEEPGRAM] Hallucination filtered: "${finalTranscript}"`);
            finalTranscript = '';
          }
          return;
        }

        if (isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + text;
          lastConfidence = confidence;
          lastLatency = latency;
        }

        ws.send(JSON.stringify({
          type: isFinal ? 'transcript_partial_final' : 'transcript_interim',
          text,
          full_text: finalTranscript,
          confidence,
          latency_ms: latency,
          is_final: isFinal,
        }));
      },
      (err) => {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    );
  }

  // 초기 메시지: 세션 정보 + 첫 질문 전송
  const firstQ = questions.questions[0];
  ws.send(JSON.stringify({
    type: 'session_start',
    session_id: sessionId,
    engine,
    question: firstQ,
    total_questions: questions.questions.length,
  }));

  sessionManager.addTurn(sessionId, 'agent', firstQ.text);

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      const chunk = Buffer.from(data);

      if (engine === 'whisper') {
        // Whisper: 클라이언트가 보낸 완전한 오디오 Blob을 한 번에 수신
        whisperAudioBuffer = chunk;
        sessionManager.appendAudioChunk(sessionId, chunk);
      } else {
        // Deepgram: PCM 스트리밍
        sessionManager.appendAudioChunk(sessionId, chunk);
        if (dgSession) dgSession.send(chunk);
      }

      if (!audioStartTime) audioStartTime = Date.now();
      return;
    }

    // 텍스트 메시지 처리
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'switch_engine': {
        sessionManager.setEngine(sessionId, msg.engine);
        ws.send(JSON.stringify({ type: 'engine_switched', engine: msg.engine }));
        break;
      }

      case 'whisper_audio_incoming': {
        // Whisper 오디오 수신 준비 (메타 정보만)
        console.log(`[WHISPER] Audio incoming: ${msg.size} bytes`);
        break;
      }

      case 'stop_recording': {
        if (engine === 'whisper') {
          try {
            const audioBuffer = whisperAudioBuffer;
            if (audioBuffer && audioBuffer.length > 0) {
              const result = await whisperHandler.transcribe(audioBuffer);

              if (isHallucination(result.transcript)) {
                console.log(`[WHISPER] Hallucination filtered: "${result.transcript}"`);
                ws.send(JSON.stringify({ type: 'transcript_rejected', reason: 'hallucination' }));
              } else {
                finalTranscript = result.transcript;
                ws.send(JSON.stringify({
                  type: 'transcript_final',
                  text: result.transcript,
                  confidence: result.confidence,
                  latency_ms: result.latency,
                  audio_duration_sec: result.audio_duration_sec,
                }));
              }
            }
            whisperAudioBuffer = null;
          } catch (err) {
            console.error('[WHISPER] Transcribe error:', err.message);
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        } else if (engine === 'deepgram' && dgSession) {
          dgSession.close();
          setTimeout(() => {
            if (transcriptSent) return;
            if (finalTranscript && !isHallucination(finalTranscript)) {
              transcriptSent = true;
              ws.send(JSON.stringify({
                type: 'transcript_final',
                text: finalTranscript,
                confidence: lastConfidence,
                latency_ms: lastLatency,
              }));
            } else if (finalTranscript) {
              console.log(`[DEEPGRAM] Hallucination filtered: "${finalTranscript}"`);
              ws.send(JSON.stringify({ type: 'transcript_rejected', reason: 'hallucination' }));
            }
          }, 500);
        }
        break;
      }

      case 'save_answer': {
        const audioDuration = audioStartTime
          ? (Date.now() - audioStartTime) / 1000
          : 0;

        const sttMetadata = {
          engine: session.stt_engine,
          latency_ms: msg.latency_ms || lastLatency,
          confidence: msg.confidence || lastConfidence,
          audio_duration_sec: msg.audio_duration_sec || audioDuration,
        };

        sessionManager.addTurn(sessionId, 'user', msg.text || finalTranscript, sttMetadata);

        // 오디오 청크 초기화 (다음 턴을 위해)
        sessionManager.clearAudioChunks(sessionId);
        audioStartTime = null;
        finalTranscript = '';
        lastConfidence = 0;
        lastLatency = 0;
        transcriptSent = false;

        // 다음 질문 전송
        sessionManager.advanceQuestion(sessionId);
        const nextIdx = sessionManager.getNextQuestionIndex(sessionId);

        if (nextIdx < questions.questions.length) {
          const nextQ = questions.questions[nextIdx];
          sessionManager.addTurn(sessionId, 'agent', nextQ.text);

          // Deepgram 모드에서 새 실시간 세션 생성
          if (engine === 'deepgram') {
            dgSession = deepgramHandler.createLiveSession(
              (text, isFinal, confidence, latency, isUtteranceEnd) => {
                if (isUtteranceEnd) {
                  if (transcriptSent) return;
                  if (finalTranscript && !isHallucination(finalTranscript)) {
                    transcriptSent = true;
                    ws.send(JSON.stringify({
                      type: 'transcript_final',
                      text: finalTranscript,
                      confidence: lastConfidence,
                      latency_ms: lastLatency,
                    }));
                  } else if (finalTranscript) {
                    console.log(`[DEEPGRAM] Hallucination filtered: "${finalTranscript}"`);
                    finalTranscript = '';
                  }
                  return;
                }
                if (isFinal) {
                  finalTranscript += (finalTranscript ? ' ' : '') + text;
                  lastConfidence = confidence;
                  lastLatency = latency;
                }
                ws.send(JSON.stringify({
                  type: isFinal ? 'transcript_partial_final' : 'transcript_interim',
                  text,
                  full_text: finalTranscript,
                  confidence,
                  latency_ms: latency,
                  is_final: isFinal,
                }));
              },
              (err) => {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
              }
            );
          }

          ws.send(JSON.stringify({
            type: 'next_question',
            question: nextQ,
            question_index: nextIdx,
            total_questions: questions.questions.length,
          }));
        } else {
          // 대화 완료 → Firebase 업로드
          await handleSessionComplete(sessionId, ws);
        }
        break;
      }

      case 'end_session': {
        await handleSessionComplete(sessionId, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Session closed: ${sessionId}`);
    if (dgSession) dgSession.close();
  });
});

async function handleSessionComplete(sessionId, ws) {
  try {
    // 마지막 응답 오디오 저장
    const lastAudio = sessionManager.getLastAnswerAudio(sessionId);
    let audioUrl = null;

    if (lastAudio && lastAudio.length > 0) {
      audioUrl = await firebaseService.uploadAudio(sessionId, lastAudio);
      if (audioUrl) {
        sessionManager.setAudioUrl(sessionId, audioUrl);
      }
    }

    // 대화 기록 Firebase에 저장
    const sessionData = sessionManager.toJSON(sessionId);
    await firebaseService.saveConversation(sessionData);

    ws.send(JSON.stringify({
      type: 'session_complete',
      session: sessionData,
    }));

    console.log(`[SESSION] Conversation saved: ${sessionId}`);
  } catch (err) {
    console.error('[SESSION] Save failed:', err.message);
    ws.send(JSON.stringify({
      type: 'error',
      message: '세션 저장 중 오류가 발생했습니다',
    }));
  }
}

server.listen(PORT, () => {
  console.log(`\n[SERVER] http://localhost:${PORT}`);
  console.log(`[SERVER] WebSocket: ws://localhost:${PORT}`);
  console.log(`[SERVER] STT engines: Deepgram / Whisper\n`);
});
