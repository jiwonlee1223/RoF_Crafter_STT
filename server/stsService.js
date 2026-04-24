const axios = require('axios');
const FormData = require('form-data');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// 남자아이 → 성인 남성 목소리 (기본: Adam)
const STS_MALE_VOICE_ID = process.env.ELEVENLABS_STS_MALE_VOICE_ID || 'mK6Q1HRYYwUJwQGwMPYw';
// 여자아이 → 성인 여성 목소리 (기본: Rachel)
const STS_FEMALE_VOICE_ID = process.env.ELEVENLABS_STS_FEMALE_VOICE_ID || 'jAAHNNqlbAX9iWjJPEtE';
const STS_MODEL_ID = process.env.ELEVENLABS_STS_MODEL_ID || 'eleven_multilingual_sts_v2';

function pcmToWav(pcmBuffer, sampleRate = 16000) {
  const numChannels = 1;
  const bitDepth = 16;
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function speechToSpeech(pcmBuffer, gender = 'female') {
  if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === 'your_api_key_here') {
    throw new Error('ELEVENLABS_API_KEY가 설정되지 않았습니다');
  }

  const voiceId = gender === 'male' ? STS_MALE_VOICE_ID : STS_FEMALE_VOICE_ID;
  const wavBuffer = pcmToWav(pcmBuffer);

  const form = new FormData();
  form.append('audio', wavBuffer, { filename: 'voice.wav', contentType: 'audio/wav' });
  form.append('model_id', STS_MODEL_ID);
  form.append('voice_settings', JSON.stringify({
    stability: 0.5,
    similarity_boost: 0.75,
  }));

  const response = await axios({
    method: 'POST',
    url: `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`,
    params: { output_format: 'pcm_16000' },
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      ...form.getHeaders(),
    },
    data: form,
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
}

module.exports = { speechToSpeech };
