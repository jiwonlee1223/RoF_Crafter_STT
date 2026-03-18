const { v4: uuidv4 } = require('uuid');

// 활성 세션을 메모리에 보관
const sessions = new Map();

const PCM_SAMPLE_RATE = 16000;
const PCM_BYTES_PER_SAMPLE = 2; // 16-bit (linear16)

function createSession(engine) {
  const sessionId = uuidv4();
  const session = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    stt_engine: engine || 'deepgram',
    conversation: [],
    currentQuestionIndex: 0,
    audioChunks: [],
    allAnswerAudioChunks: [],
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function addTurn(sessionId, role, text, sttMetadata = null) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const turn = {
    turn: session.conversation.length + 1,
    role,
    text,
    timestamp: new Date().toISOString(),
  };

  if (sttMetadata) {
    turn.stt_metadata = sttMetadata;
  }

  session.conversation.push(turn);
  return turn;
}

function getNextQuestionIndex(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return -1;
  return session.currentQuestionIndex;
}

function advanceQuestion(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.currentQuestionIndex += 1;
}

function setEngine(sessionId, engine) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.stt_engine = engine;
}

function appendAudioChunk(sessionId, chunk) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.audioChunks.push(chunk);
  session.allAnswerAudioChunks.push(chunk);
}

function clearAudioChunks(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.audioChunks = [];
}

function getAllAnswerAudio(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.allAnswerAudioChunks.length === 0) return null;
  return Buffer.concat(session.allAnswerAudioChunks);
}

function getAllAnswerAudioDuration(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return 0;
  const totalBytes = session.allAnswerAudioChunks.reduce((sum, c) => sum + c.length, 0);
  return totalBytes / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE);
}

function getAudioBuffer(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return Buffer.concat(session.audioChunks);
}

function toJSON(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    session_id: session.session_id,
    created_at: session.created_at,
    stt_engine: session.stt_engine,
    conversation: session.conversation,
    last_answer_audio_url: session.last_answer_audio_url || null,
  };
}

function setAudioUrl(sessionId, url) {
  const session = sessions.get(sessionId);
  if (session) {
    session.last_answer_audio_url = url;
  }
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = {
  createSession,
  getSession,
  addTurn,
  getNextQuestionIndex,
  advanceQuestion,
  setEngine,
  appendAudioChunk,
  clearAudioChunks,
  getAllAnswerAudio,
  getAllAnswerAudioDuration,
  getAudioBuffer,
  toJSON,
  setAudioUrl,
  deleteSession,
};
