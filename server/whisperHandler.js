const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

let openai = null;

function init() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[WHISPER] OpenAI API key not set');
    return;
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('[WHISPER] OpenAI client initialized');
}

/**
 * 오디오 버퍼를 Whisper API로 전사한다.
 * @param {Buffer} audioBuffer - WebM/WAV 형식 오디오 바이너리
 * @param {string} mimeType - MIME 타입 (기본 audio/webm)
 * @returns {Promise<{transcript: string, latency: number}>}
 */
async function transcribe(audioBuffer, mimeType = 'audio/webm') {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }

  const ext = mimeType.includes('wav') ? 'wav' : 'webm';
  const tmpPath = path.join(os.tmpdir(), `whisper_${Date.now()}.${ext}`);

  try {
    fs.writeFileSync(tmpPath, audioBuffer);

    const startTime = Date.now();
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      language: 'ko',
      response_format: 'verbose_json',
    });
    const latency = Date.now() - startTime;

    const transcript = response.text || '';
    const duration = response.duration || 0;

    return {
      transcript,
      latency,
      audio_duration_sec: duration,
      confidence: null,
    };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = { init, transcribe };
