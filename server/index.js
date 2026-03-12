require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const deepgramHandler = require('./deepgramHandler');
const agentService = require('./agentService');
const sessionManager = require('./sessionManager');
const firebaseService = require('./firebaseService');
const questions = require('./questions.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const MAX_TURNS = questions.questions.length;

const HALLUCINATION_PATTERNS = [
  '시청해주셔서 감사합니다',
  '시청해 주셔서 감사합니다',
  '구독과 좋아요',
  '좋아요와 구독',
  '다음 영상에서 만나요',
  '다음 영상에서 뵙겠습니다',
  'MBC 뉴스', 'KBS 뉴스', 'SBS 뉴스',
  '지금까지',
  '감사합니다 감사합니다',
  'Thank you for watching',
  'Please subscribe',
];

function isHallucination(text) {
  if (!text || text.trim().length === 0) return true;
  return HALLUCINATION_PATTERNS.some(p => text.trim().includes(p));
}

deepgramHandler.init();
agentService.init();
firebaseService.init();

console.log(`[SERVER] Loaded ${MAX_TURNS} questions from questions.json`);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

app.get('/api/session/:sessionId', (req, res) => {
  const data = sessionManager.toJSON(req.params.sessionId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  res.json(data);
});

wss.on('connection', async (ws) => {
  const session = sessionManager.createSession('deepgram');
  const sessionId = session.session_id;
  let questionIndex = 0;

  console.log(`[WS] New session: ${sessionId}`);

  let dgSession = null;
  let audioStartTime = null;
  let finalTranscript = '';
  let lastConfidence = 0;
  let lastLatency = 0;

  // 첫 인사 — questions.json[0]을 참고
  const firstRef = questions.questions[0].text;
  let greeting;
  try {
    greeting = await agentService.generateGreeting(firstRef);
  } catch (err) {
    console.error('[AGENT] Greeting failed:', err.message);
    greeting = firstRef;
  }

  sessionManager.addTurn(sessionId, 'agent', greeting);
  questionIndex++;
  console.log(`[FLOW] Greeting sent (ref: "${firstRef}"), questionIndex=${questionIndex}/${MAX_TURNS}`);

  ws.send(JSON.stringify({
    type: 'session_start',
    session_id: sessionId,
    question: { text: greeting },
    turn: questionIndex,
    max_turns: MAX_TURNS,
  }));

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (!audioStartTime) {
        audioStartTime = Date.now();
      }
      const chunk = Buffer.from(data);
      sessionManager.appendAudioChunk(sessionId, chunk);
      if (dgSession) dgSession.send(chunk);
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {
      case 'start_recording': {
        console.log('[REC] start_recording received');
        finalTranscript = '';
        lastConfidence = 0;
        lastLatency = 0;
        audioStartTime = null;

        dgSession = deepgramHandler.createLiveSession(
          (text, isFinal, confidence, latency) => {
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
            console.error('[DG] Session error:', err.message);
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        );
        break;
      }

      case 'stop_recording': {
        console.log(`[REC] stop_recording, finalTranscript="${finalTranscript}"`);

        if (dgSession) {
          dgSession.close();
          dgSession = null;
        }

        if (finalTranscript && !isHallucination(finalTranscript)) {
          ws.send(JSON.stringify({
            type: 'transcript_final',
            text: finalTranscript,
            confidence: lastConfidence,
            latency_ms: lastLatency,
          }));
        }
        break;
      }

      case 'save_answer': {
        const userText = msg.text || finalTranscript;
        console.log(`[SAVE] User answer: "${userText}"`);

        const audioDuration = audioStartTime
          ? (Date.now() - audioStartTime) / 1000 : 0;

        sessionManager.addTurn(sessionId, 'user', userText, {
          engine: 'deepgram',
          latency_ms: msg.latency_ms || lastLatency,
          confidence: msg.confidence || lastConfidence,
          audio_duration_sec: msg.audio_duration_sec || audioDuration,
        });

        sessionManager.clearAudioChunks(sessionId);
        finalTranscript = '';
        audioStartTime = null;

        // 모든 질문 소진 → 세션 종료
        if (questionIndex >= MAX_TURNS) {
          console.log(`[FLOW] All ${MAX_TURNS} questions done, completing session`);
          await handleSessionComplete(sessionId, ws);
          break;
        }

        // GPT로 다음 응답 생성 — questions.json[questionIndex]를 참고
        const nextRef = questions.questions[questionIndex].text;
        console.log(`[FLOW] Generating response for question ${questionIndex + 1}/${MAX_TURNS} (ref: "${nextRef}")`);

        try {
          ws.send(JSON.stringify({ type: 'agent_thinking' }));

          const history = sessionManager.getSession(sessionId).conversation
            .map(t => ({ role: t.role, text: t.text }));

          const agentResponse = await agentService.generateResponse(history, nextRef);
          sessionManager.addTurn(sessionId, 'agent', agentResponse);
          questionIndex++;

          ws.send(JSON.stringify({
            type: 'next_question',
            question: { text: agentResponse },
            turn: questionIndex,
            max_turns: MAX_TURNS,
          }));
        } catch (err) {
          console.error('[AGENT] Response generation failed:', err.message);
          ws.send(JSON.stringify({ type: 'error', message: 'Agent response failed' }));
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
    if (dgSession) { dgSession.close(); dgSession = null; }
  });
});

async function handleSessionComplete(sessionId, ws) {
  try {
    const lastAudio = sessionManager.getLastAnswerAudio(sessionId);
    let audioUrl = null;
    if (lastAudio && lastAudio.length > 0) {
      audioUrl = await firebaseService.uploadAudio(sessionId, lastAudio);
      if (audioUrl) sessionManager.setAudioUrl(sessionId, audioUrl);
    }

    const sessionData = sessionManager.toJSON(sessionId);
    await firebaseService.saveConversation(sessionData);

    ws.send(JSON.stringify({ type: 'session_complete', session: sessionData }));
    console.log(`[SESSION] Conversation saved: ${sessionId}`);
  } catch (err) {
    console.error('[SESSION] Save failed:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: 'Session save failed' }));
  }
}

server.listen(PORT, () => {
  console.log(`\n[SERVER] http://localhost:${PORT}`);
  console.log(`[SERVER] WebSocket: ws://localhost:${PORT}\n`);
});
