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

/**
 * Deepgram 실시간 STT 세션을 생성한다.
 * @param {Function} onTranscript - (text, isFinal, confidence) 콜백
 * @param {Function} onError - (error) 콜백
 * @returns {{ send, close }} 오디오 청크 전송/종료 핸들
 */
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
    utterance_end_ms: 1500,
    vad_events: true,
    encoding: 'linear16',
    sample_rate: 16000,
  });

  const startTime = Date.now();

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[DEEPGRAM] Connection opened');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data.channel?.alternatives?.[0];
    if (!alt) return;

    const transcript = alt.transcript;
    if (!transcript) return;

    const isFinal = data.is_final;
    const confidence = alt.confidence || 0;
    const latency = Date.now() - startTime;

    onTranscript(transcript, isFinal, confidence, latency);
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    onTranscript('', true, 0, Date.now() - startTime, true);
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[DEEPGRAM] Error:', err);
    onError(err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[DEEPGRAM] Connection closed');
  });

  return {
    send: (audioChunk) => {
      if (connection.getReadyState() === 1) {
        connection.send(audioChunk);
      }
    },
    close: () => {
      connection.requestClose();
    },
  };
}

module.exports = { init, createLiveSession };
