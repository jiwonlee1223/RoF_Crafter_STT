const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

let deepgramClient = null;

function init() {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.warn('[DEEPGRAM] API key not set');
    return;
  }
  deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
  console.log('[DEEPGRAM] Client initialized');
}

function createLiveSession(onTranscript, onError) {
  if (!deepgramClient) {
    onError(new Error('Deepgram client not initialized'));
    return null;
  }

  const connection = deepgramClient.listen.live({
    model: 'nova-2',
    language: 'ko',
    smart_format: true,
    interim_results: true,
    encoding: 'linear16',
    sample_rate: 16000,
  });

  const startTime = Date.now();
  let isOpen = false;
  const pendingChunks = [];

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[DEEPGRAM] Connection opened');
    isOpen = true;
    // 버퍼에 쌓인 청크를 모두 전송
    while (pendingChunks.length > 0) {
      connection.send(pendingChunks.shift());
    }
    console.log(`[DEEPGRAM] Flushed ${pendingChunks.length} buffered chunks`);
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data.channel?.alternatives?.[0];
    if (!alt || !alt.transcript) return;

    onTranscript(alt.transcript, data.is_final, alt.confidence || 0, Date.now() - startTime);
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[DEEPGRAM] Error:', err);
    onError(err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[DEEPGRAM] Connection closed');
    isOpen = false;
  });

  return {
    send: (chunk) => {
      if (isOpen) {
        connection.send(chunk);
      } else {
        pendingChunks.push(chunk);
      }
    },
    close: () => {
      connection.requestClose();
    },
  };
}

// ── Pre-recorded (batch) transcription ──
function createWavBuffer(pcmBuffer) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function transcribePreRecorded(pcmBuffer) {
  if (!deepgramClient) throw new Error('Deepgram client not initialized');

  const wavBuffer = createWavBuffer(pcmBuffer);
  console.log(`[DEEPGRAM] Pre-recorded transcription: ${(wavBuffer.length / 1024).toFixed(1)}KB WAV`);

  const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
    wavBuffer,
    {
      model: 'nova-2',
      language: 'ko',
      smart_format: true,
    }
  );

  if (error) throw error;

  const alt = result?.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript || '';
  const confidence = alt?.confidence || 0;
  console.log(`[DEEPGRAM] Pre-recorded result: "${text}" (confidence: ${confidence})`);

  return { text, confidence };
}

module.exports = { init, createLiveSession, transcribePreRecorded };
