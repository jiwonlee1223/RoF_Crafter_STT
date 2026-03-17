require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const multer = require('multer');
const deepgramHandler = require('./deepgramHandler');
const agentService = require('./agentService');
const sessionManager = require('./sessionManager');
const firebaseService = require('./firebaseService');
const comfyuiService = require('./comfyuiService');
const geminiImageGen = require('./gemini-image-gen');
const questions = require('./questions');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
comfyuiService.init();

console.log(`[SERVER] Loaded ${MAX_TURNS} questions from questions.js`);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// ── 회원가입 ──
app.post('/api/register', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요' });
    }
    if (userId.length < 2) {
      return res.status(400).json({ error: '아이디는 2자 이상이어야 합니다' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다' });
    }
    await firebaseService.registerUser(userId, password);
    res.json({ success: true, userId });
  } catch (err) {
    console.error('[AUTH] Register failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── 로그인 ──
app.post('/api/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요' });
    }
    await firebaseService.loginUser(userId, password);
    res.json({ success: true, userId });
  } catch (err) {
    console.error('[AUTH] Login failed:', err.message);
    res.status(401).json({ error: err.message });
  }
});

// ── 음성 파일 업로드 ──
app.post('/upload-voice', upload.single('voice'), async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: '사용자 ID가 필요합니다' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '음성 파일이 필요합니다' });
    }

    const result = await firebaseService.saveVoice(
      userId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );

    if (!result) {
      return res.status(500).json({ error: '음성 저장에 실패했습니다' });
    }

    res.json({ success: true, userId, mp3File: result });
  } catch (err) {
    console.error('[VOICE] Upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:sessionId', (req, res) => {
  const data = sessionManager.toJSON(req.params.sessionId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  res.json(data);
});

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const loggedInUserId = params.get('userId') || null;
  const userName = params.get('userName') || null;
  const userGender = params.get('gender') || 'female';
  const birthDateTime = params.get('birthDateTime') || null;

  const session = sessionManager.createSession('deepgram');
  const sessionId = session.session_id;
  let questionIndex = 0;

  console.log(`[WS] New session: ${sessionId}, userId: ${loggedInUserId || '(anonymous)'}, name: ${userName || '-'}, gender: ${userGender}, birth: ${birthDateTime || '-'}`);

  let dgSession = null;
  let audioStartTime = null;
  let finalTranscript = '';
  let lastConfidence = 0;
  let lastLatency = 0;
  let personaStylePrompt = null;

  // 첫 인사 — questions[0]을 참고, 사용자 이름 반영
  const firstRef = questions.questions[0].text;
  let greeting;
  try {
    greeting = await agentService.generateGreeting(firstRef, userName);
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
        console.log(`[REC] stop_recording received, current finalTranscript="${finalTranscript}"`);

        // Deepgram이 마지막 is_final 이벤트를 보낼 시간을 확보한 후 종료
        setTimeout(() => {
          console.log(`[REC] After delay, finalTranscript="${finalTranscript}"`);

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
          } else {
            console.log('[REC] Empty or hallucinated transcript, resetting mic');
            ws.send(JSON.stringify({ type: 'transcript_rejected' }));
          }
        }, 1000);
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
          await handleSessionComplete(sessionId, ws, loggedInUserId, birthDateTime);
          break;
        }

        // GPT로 다음 응답 생성 — questions[questionIndex]를 참고
        const nextRef = questions.questions[questionIndex].text;
        console.log(`[FLOW] Generating response for question ${questionIndex + 1}/${MAX_TURNS} (ref: "${nextRef}")`);

        try {
          ws.send(JSON.stringify({ type: 'agent_thinking' }));

          const history = sessionManager.getSession(sessionId).conversation
            .map(t => ({ role: t.role, text: t.text }));

          const agentResponse = await agentService.generateResponse(history, nextRef, userName);
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
        await handleSessionComplete(sessionId, ws, loggedInUserId, birthDateTime, (fp) => {
          personaStylePrompt = fp;
        });
        break;
      }

      // 클라이언트에서 비디오 생성 요청
      case 'generate_video': {
        const userId = msg.userId || loggedInUserId || sessionId;
        const gender = msg.gender || userGender || 'female';
        console.log(`[VIDEO] generate_video request: userId=${userId}, gender=${gender}`);

        try {
          if (!msg.fileBuffer) {
            ws.send(JSON.stringify({ type: 'error', message: '이미지가 필요합니다' }));
            break;
          }

          const rawImage = Buffer.from(msg.fileBuffer);

          // Gemini로 이미지 전처리 (image-to-image)
          ws.send(JSON.stringify({ type: 'video_status', status: 'preprocessing' }));
          let imageToUpload = rawImage;
          try {
            const geminiPrompt = geminiImageGen.getBaseImagePrompt(gender, birthDateTime, personaStylePrompt);
            console.log(`[VIDEO] Gemini preprocessing with prompt (${geminiPrompt.length} chars)`);
            imageToUpload = await geminiImageGen.generateImageWithGemini({
              imageBuffer: rawImage,
              prompt: geminiPrompt,
            });
            console.log(`[VIDEO] Gemini preprocessing done, output=${imageToUpload.length} bytes`);
          } catch (geminiErr) {
            console.warn(`[VIDEO] Gemini preprocessing failed, using original:`, geminiErr.message);
            imageToUpload = rawImage;
          }

          // 전처리된 이미지를 ComfyUI에 업로드
          ws.send(JSON.stringify({ type: 'video_status', status: 'uploading' }));
          await comfyuiService.uploadImage(imageToUpload);

          // 워크플로우 로드 및 수정
          const workflow = comfyuiService.loadWorkflow(gender);
          comfyuiService.prepareWorkflow(workflow, {
            userId,
            speakingPrompt: msg.speakingPrompt,
            listeningPrompt: msg.listeningPrompt,
          });

          ws.send(JSON.stringify({ type: 'video_status', status: 'generating' }));

          // ComfyUI에 제출
          const promptId = await comfyuiService.submitWorkflow(workflow, {
            onProgress: (nodes) => {
              const finished = Object.values(nodes).filter(n => n.state === 'finished').length;
              const total = Object.keys(nodes).length;
              ws.send(JSON.stringify({
                type: 'video_progress',
                finished,
                total,
              }));
            },
            onComplete: async (result) => {
              console.log(`[VIDEO] Complete: speaking=${result.speaking}, listening=${result.listening}`);
              ws.send(JSON.stringify({
                type: 'video_complete',
                speakingUrl: result.speaking,
                listeningUrl: result.listening,
              }));
              await firebaseService.saveGeneratedVideo(userId, {
                speakingUrl: result.speaking,
                listeningUrl: result.listening,
              });
            },
            onError: (err) => {
              console.error('[VIDEO] Error:', err.message);
              ws.send(JSON.stringify({ type: 'error', message: 'Video generation failed' }));
            },
          });

          console.log(`[VIDEO] Submitted, promptId=${promptId}`);
        } catch (err) {
          console.error('[VIDEO] generate_video failed:', err.message);
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Session closed: ${sessionId}`);
    if (dgSession) { dgSession.close(); dgSession = null; }
  });
});

async function handleSessionComplete(sessionId, ws, userId, birthDateTime, onFashionPrompt) {
  try {
    const lastAudio = sessionManager.getLastAnswerAudio(sessionId);
    let audioUrl = null;
    if (lastAudio && lastAudio.length > 0) {
      audioUrl = await firebaseService.uploadAudio(sessionId, lastAudio);
      if (audioUrl) sessionManager.setAudioUrl(sessionId, audioUrl);

      const voiceUserId = userId || sessionId;
      await firebaseService.saveVoice(voiceUserId, lastAudio, 'recorded_voice.mp3', 'audio/mpeg');
    }

    const sessionData = sessionManager.toJSON(sessionId);
    if (userId) sessionData.userId = userId;
    const docUserId = userId || sessionId;

    // responses/{userId}/default/data에 대화 저장
    await firebaseService.saveConversation(docUserId, sessionData);

    const turnCount = sessionData.conversation ? sessionData.conversation.length : 0;
    await firebaseService.saveChatHistory(sessionId, userId, turnCount);

    ws.send(JSON.stringify({ type: 'session_complete', session: sessionData }));
    console.log(`[SESSION] Conversation saved: ${sessionId}`);

    // 페르소나 생성은 비동기로 (클라이언트 응답 블로킹 없이)
    const history = sessionData.conversation || [];
    generateAndSavePersona(docUserId, history, birthDateTime, onFashionPrompt);
  } catch (err) {
    console.error('[SESSION] Save failed:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: 'Session save failed' }));
  }
}

async function generateAndSavePersona(userId, conversationHistory, birthDateTime, onFashionPrompt) {
  try {
    console.log(`[PERSONA] Generating exhib persona for: ${userId}`);
    const { personaText, cardText, fashionPrompt } = await agentService.generateExhibPersona(conversationHistory, birthDateTime);
    await firebaseService.saveExhibPersona(userId, personaText, cardText);
    if (fashionPrompt && onFashionPrompt) {
      onFashionPrompt(fashionPrompt);
      console.log(`[PERSONA] Fashion prompt saved for video: "${fashionPrompt}"`);
    }
    console.log(`[PERSONA] Exhib persona complete for: ${userId}`);
  } catch (err) {
    console.error(`[PERSONA] Generation failed for ${userId}:`, err.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n[SERVER] http://localhost:${PORT}`);
  console.log(`[SERVER] WebSocket: ws://localhost:${PORT}\n`);
});
