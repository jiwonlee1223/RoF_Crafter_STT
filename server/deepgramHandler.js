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

module.exports = { init, createLiveSession };
