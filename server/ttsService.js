const axios = require('axios');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';
const TTS_SAMPLE_RATE = 24000;

function init() {
  if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === 'your_api_key_here') {
    console.warn('[TTS] ELEVENLABS_API_KEY가 설정되지 않았습니다. TTS 기능이 비활성화됩니다.');
    return;
  }
  console.log(`[TTS] ElevenLabs 초기화 완료 (voice: ${ELEVENLABS_VOICE_ID}, model: ${ELEVENLABS_MODEL_ID})`);
}

async function streamTTS(text, res) {
  if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === 'your_api_key_here') {
    throw new Error('ELEVENLABS_API_KEY가 설정되지 않았습니다');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream?output_format=pcm_${TTS_SAMPLE_RATE}`;

  const response = await axios({
    method: 'POST',
    url,
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      text,
      model_id: ELEVENLABS_MODEL_ID,
      language_code: 'ko',
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.3,
        speed: 1.2,
        use_speaker_boost: true,
      },
    },
    responseType: 'stream',
  });

  res.set({
    'Content-Type': 'application/octet-stream',
    'X-Sample-Rate': String(TTS_SAMPLE_RATE),
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });

  response.data.pipe(res);
}

module.exports = { init, streamTTS };
