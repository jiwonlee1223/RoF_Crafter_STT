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
const ttsService = require('./ttsService');
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
ttsService.init();

console.log(`[SERVER] Loaded ${MAX_TURNS} questions from questions.js`);

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// ── 회원가입 ──
app.post('/api/register', async (req, res) => {
  try {
    const { userId: name, password: birth } = req.body;
    if (!name || !birth) {
      return res.status(400).json({ error: '이름과 생년월일을 입력해주세요' });
    }
    if (name.length < 2) {
      return res.status(400).json({ error: '이름은 2자 이상이어야 합니다' });
    }
    if (!/^\d{6}$/.test(birth)) {
      return res.status(400).json({ error: '생년월일 6자리 숫자를 입력해주세요 (예: 990315)' });
    }
    const internalId = `${name}_${birth}`;
    await firebaseService.registerUser(internalId, birth);
    res.json({ success: true, userId: internalId });
  } catch (err) {
    console.error('[AUTH] Register failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── 로그인 ──
app.post('/api/login', async (req, res) => {
  try {
    const { userId: name, password: birth } = req.body;
    if (!name || !birth) {
      return res.status(400).json({ error: '이름과 생년월일을 입력해주세요' });
    }
    const internalId = `${name}_${birth}`;
    await firebaseService.loginUser(internalId, birth);
    res.json({ success: true, userId: internalId });
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

// ── ElevenLabs TTS ──
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: '텍스트가 필요합니다' });
    await ttsService.streamTTS(text, res);
  } catch (err) {
    console.error('[TTS] Stream failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'TTS 변환 실패' });
    }
  }
});

app.get('/api/session/:sessionId', (req, res) => {
  const data = sessionManager.toJSON(req.params.sessionId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  res.json(data);
});

// ── 저장된 음성 재생 (Storage에서 WAV 스트리밍) ──
app.get('/api/voice/:userId', async (req, res) => {
  try {
    const voiceDoc = await firebaseService.getVoice(req.params.userId);
    if (!voiceDoc) {
      return res.status(404).json({ error: '음성 데이터를 찾을 수 없습니다' });
    }

    if (voiceDoc.storageUrl) {
      console.log(`[VOICE] Redirecting to Storage for ${req.params.userId} (${voiceDoc.durationSec}s)`);
      return res.redirect(voiceDoc.storageUrl);
    }

    // 레거시: Firestore에 base64로 저장된 경우
    if (voiceDoc.audioData) {
      const pcmBuffer = Buffer.from(voiceDoc.audioData, 'base64');
      const byteRate = 16000 * 1 * 2;
      const dataSize = pcmBuffer.length;

      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(44 + dataSize - 8, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(16000, 24);
      header.writeUInt32LE(byteRate, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([header, pcmBuffer]);
      res.set({ 'Content-Type': 'audio/wav', 'Content-Length': wavBuffer.length });
      return res.send(wavBuffer);
    }

    return res.status(404).json({ error: '음성 데이터를 찾을 수 없습니다' });
  } catch (err) {
    console.error('[VOICE] Playback failed:', err.message);
    res.status(500).json({ error: '음성 재생 실패' });
  }
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

  let audioStartTime = null;
  let finalTranscript = '';
  let lastConfidence = 0;
  let personaStylePrompt = null;
  const userAge = getAge(birthDateTime);

  // 첫 인사 — questions[0]을 참고, 사용자 이름 반영
  const firstRef = questions.questions[0].text;
  let greeting;
  try {
    greeting = await agentService.generateGreeting(firstRef, userName, userAge);
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
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {
      case 'start_recording': {
        console.log('[REC] start_recording received');
        finalTranscript = '';
        lastConfidence = 0;
        audioStartTime = null;
        sessionManager.clearAudioChunks(sessionId);
        break;
      }

      case 'stop_recording': {
        console.log('[REC] stop_recording received, transcribing recorded audio...');

        const audioDuration = audioStartTime
          ? (Date.now() - audioStartTime) / 1000 : 0;
        const pcmBuffer = sessionManager.getAudioBuffer(sessionId);

        if (!pcmBuffer || pcmBuffer.length === 0) {
          console.log('[REC] No audio data recorded');
          ws.send(JSON.stringify({ type: 'transcript_rejected' }));
          break;
        }

        try {
          const { text, confidence } = await deepgramHandler.transcribePreRecorded(pcmBuffer);
          finalTranscript = text;
          lastConfidence = confidence;

          if (finalTranscript && !isHallucination(finalTranscript)) {
            ws.send(JSON.stringify({
              type: 'transcript_final',
              text: finalTranscript,
              confidence: lastConfidence,
              audio_duration_sec: audioDuration,
            }));
          } else {
            console.log('[REC] Empty or hallucinated transcript, resetting mic');
            ws.send(JSON.stringify({ type: 'transcript_rejected' }));
          }
        } catch (err) {
          console.error('[REC] Pre-recorded transcription failed:', err.message);
          ws.send(JSON.stringify({ type: 'transcript_rejected' }));
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
          latency_ms: msg.latency_ms || 0,
          confidence: msg.confidence || lastConfidence,
          audio_duration_sec: msg.audio_duration_sec || audioDuration,
        });

        sessionManager.clearAudioChunks(sessionId);
        finalTranscript = '';
        audioStartTime = null;

        // 모든 질문 소진 → 마무리 멘트 후 세션 종료
        if (questionIndex >= MAX_TURNS) {
          console.log(`[FLOW] All ${MAX_TURNS} questions done, sending closing remark`);
          try {
            ws.send(JSON.stringify({ type: 'agent_thinking' }));

            const history = sessionManager.getSession(sessionId).conversation
              .map(t => ({ role: t.role, text: t.text }));

            const closingRemark = await agentService.generateClosingRemark(history, userName);
            sessionManager.addTurn(sessionId, 'agent', closingRemark);

            ws.send(JSON.stringify({
              type: 'closing_remark',
              question: { text: closingRemark },
            }));
          } catch (err) {
            console.error('[AGENT] Closing remark failed:', err.message);
            // 실패해도 세션 종료는 진행
            await handleSessionComplete(sessionId, ws, loggedInUserId, birthDateTime, userName, userGender, (fp) => {
              personaStylePrompt = fp;
            });
          }
          break;
        }

        // GPT로 다음 응답 생성 — questions[questionIndex]를 참고
        const nextRef = questions.questions[questionIndex].text;
        console.log(`[FLOW] Generating response for question ${questionIndex + 1}/${MAX_TURNS} (ref: "${nextRef}")`);

        try {
          ws.send(JSON.stringify({ type: 'agent_thinking' }));

          const history = sessionManager.getSession(sessionId).conversation
            .map(t => ({ role: t.role, text: t.text }));

          const agentResponse = await agentService.generateResponse(history, nextRef, userName, userAge);
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
        await handleSessionComplete(sessionId, ws, loggedInUserId, birthDateTime, userName, userGender, (fp) => {
          personaStylePrompt = fp;
        });
        break;
      }

      // 클라이언트에서 비디오 생성 요청
      case 'generate_video': {
        const userId = msg.userId || loggedInUserId || sessionId;
        const gender = msg.gender || userGender || 'female';
        console.log(`[VIDEO] generate_video request: userId=${userId}, gender=${gender}, personaStylePrompt=${personaStylePrompt ? `"${personaStylePrompt.substring(0, 60)}..."` : 'null'}`);

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

          // ComfyUI 비디오 생성과 동시에 미래 장면 이미지 생성 (병렬)
          const history = sessionManager.getSession(sessionId)?.conversation
            ?.map(t => ({ role: t.role, text: t.text })) || [];

          if (history.length > 0) {
            geminiImageGen.generateFutureScenes({
              conversationHistory: history,
              userName,
              birthDateTime,
              gender,
              rawImageBuffer: rawImage,
              portraitImageBuffer: imageToUpload,
            }).then(async (futureImages) => {
              console.log(`[FUTURE] ${futureImages.length} future scene images generated for userId=${userId}`);
              const saved = await firebaseService.saveFutureImages(userId, futureImages);
              if (!saved) {
                console.error(`[FUTURE] saveFutureImages returned null for userId=${userId}`);
              }
              if (saved) {
                ws.send(JSON.stringify({
                  type: 'future_scenes_complete',
                  scenes: saved.map(s => ({ year: s.year, description: s.description, imageUrl: s.imageUrl })),
                }));
              }
            }).catch(err => {
              console.error('[FUTURE] Future scenes generation failed:', err.message);
              ws.send(JSON.stringify({ type: 'future_scenes_error', message: err.message }));
            });
          }
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
    console.log(`[WS] Cleaning up session: ${sessionId}`);
  });
});

const MIN_VOICE_DURATION_SEC = 4.6;

function getAge(birthDateStr) {
  if (!birthDateStr) return null;
  const today = new Date();
  const birth = new Date(birthDateStr);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// 변성기 효과: 성별에 따라 다른 파라미터 적용
// 남자: F0 급락(-8) + 강한 저음 + 심한 갈라짐
// 여자: F0 소폭(-2) + 약한 저음 + 거의 없는 갈라짐
function shiftPitchDown(pcmBuffer, gender = 'female') {
  const { spawn } = require('child_process');

  const params = gender === 'male'
    ? { semitones: -8, eqFreq: 250, eqGain: 6,  cutFreq: 3500, cutGain: -6, vibratoD: 0.05 }
    : gender === 'neutral'
    ? { semitones: -5, eqFreq: 275, eqGain: 4,  cutFreq: 3750, cutGain: -4, vibratoD: 0.03 }
    : { semitones: -2, eqFreq: 300, eqGain: 2,  cutFreq: 4000, cutGain: -2, vibratoD: 0.01 };

  const rate = Math.pow(2, params.semitones / 12);
  const tempo = 1 / rate;

  const audioFilter = [
    `asetrate=16000*${rate}`,
    `aresample=16000`,
    `atempo=${tempo}`,
    `equalizer=f=${params.eqFreq}:width_type=o:width=2:g=${params.eqGain}`,
    `equalizer=f=${params.cutFreq}:width_type=o:width=2:g=${params.cutGain}`,
    `vibrato=f=4:d=${params.vibratoD}`,
  ].join(',');

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0',
      '-af', audioFilter,
      '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1',
    ]);

    const chunks = [];
    ff.stdout.on('data', chunk => chunks.push(chunk));
    ff.stdout.on('end', () => resolve(Buffer.concat(chunks)));
    ff.stderr.on('data', () => {});  // ffmpeg 로그 억제
    ff.on('error', reject);
    ff.stdin.write(pcmBuffer);
    ff.stdin.end();
  });
}

async function handleSessionComplete(sessionId, ws, userId, birthDateTime, userName, gender, onFashionPrompt) {
  console.log(`[SESSION] handleSessionComplete called — onFashionPrompt=${typeof onFashionPrompt}`);
  try {
    const combinedAudio = sessionManager.getAllAnswerAudio(sessionId);
    const audioDuration = sessionManager.getAllAnswerAudioDuration(sessionId);
    let audioUrl = null;

    if (combinedAudio && combinedAudio.length > 0) {
      console.log(`[VOICE] Combined audio: ${(combinedAudio.length / 1024).toFixed(1)}KB, duration: ${audioDuration.toFixed(1)}s`);

      if (audioDuration < MIN_VOICE_DURATION_SEC) {
        console.warn(`[VOICE] Audio too short (${audioDuration.toFixed(1)}s < ${MIN_VOICE_DURATION_SEC}s) — skipping voice save`);
      } else {
        const voiceUserId = userId || sessionId;
        const age = getAge(birthDateTime);
        let audioToSave = combinedAudio;
        if (age !== null && age <= 13) {
          try {
            audioToSave = await shiftPitchDown(combinedAudio, gender);
            const p = gender === 'male' ? '-8 semitones, vibrato 0.05' : gender === 'neutral' ? '-5 semitones, vibrato 0.03' : '-2 semitones, vibrato 0.01';
            console.log(`[VOICE] Age ${age} ≤ 13, gender=${gender} — voice aging applied (${p})`);
          } catch (err) {
            console.warn('[VOICE] Pitch shift failed, saving original:', err.message);
          }
        }
        audioUrl = await firebaseService.uploadAudio(sessionId, audioToSave);
        if (audioUrl) sessionManager.setAudioUrl(sessionId, audioUrl);
        await firebaseService.saveVoice(voiceUserId, audioToSave, 'recorded_voice.mp3', 'audio/mpeg');
      }
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

    const history = sessionData.conversation || [];
    const genderForPersona = gender || 'female';

    // 대화 요약 생성 (페르소나 생성과 병렬 실행)
    const summaryPromise = agentService.generateConversationSummary(history, userName)
      .then(summary => {
        console.log(`[SESSION] conversation_summary generated: "${summary.slice(0, 80)}..."`);
        ws.send(JSON.stringify({ type: 'conversation_summary', text: summary }));
        console.log(`[SESSION] conversation_summary sent`);
      })
      .catch(err => {
        console.error('[SESSION] Summary generation failed:', err.message, err.stack);
        ws.send(JSON.stringify({ type: 'conversation_summary', text: '자리를 이동하지 마시고 조금만 기다려주세요.\n촬영 준비를 하고 있습니다.' }));
      });

    await Promise.all([
      generateAndSavePersona(docUserId, history, birthDateTime, userName, genderForPersona, onFashionPrompt),
      summaryPromise,
    ]);

    ws.send(JSON.stringify({ type: 'persona_ready' }));
    console.log(`[SESSION] persona_ready sent to client`);
  } catch (err) {
    console.error('[SESSION] Save failed:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: 'Session save failed' }));
    // 페르소나 생성 실패해도 비디오 생성은 허용
    ws.send(JSON.stringify({ type: 'persona_ready' }));
  }
}

async function generateAndSavePersona(userId, conversationHistory, birthDateTime, userName, gender, onFashionPrompt) {
  try {
    console.log(`[PERSONA] Generating exhib persona for: ${userId}, gender: ${gender}`);
    const { personaText, cardText, fashionPrompt, personaVars } = await agentService.generateExhibPersona(conversationHistory, birthDateTime, userName, gender);
    await firebaseService.saveExhibPersona(userId, personaText, cardText, personaVars);
    if (fashionPrompt && onFashionPrompt) {
      onFashionPrompt(fashionPrompt);
      console.log(`[PERSONA] Fashion prompt saved for video: "${fashionPrompt}"`);
    } else {
      console.warn(`[PERSONA] Fashion prompt NOT applied — fashionPrompt=${fashionPrompt ? `"${fashionPrompt}"` : 'empty'}, onFashionPrompt=${typeof onFashionPrompt}`);
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
