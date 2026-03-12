(() => {
  'use strict';

  // --- Login DOM ---
  const loginScreen = document.getElementById('login-screen');
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const loginUserIdInput = document.getElementById('login-userid');
  const loginPasswordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');
  const userBadge = document.getElementById('user-badge');
  const btnLogout = document.getElementById('btn-logout');

  // --- App DOM ---
  const connectionStatus = document.getElementById('connection-status');
  const sessionIdEl = document.getElementById('session-id');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const chatMessages = document.getElementById('chat-messages');
  const conversation = document.getElementById('conversation');
  const liveTranscriptSection = document.getElementById('live-transcript-section');
  const liveTranscript = document.getElementById('live-transcript');
  const btnStart = document.getElementById('btn-start');
  const micLabel = document.getElementById('mic-label');
  const visualizerCanvas = document.getElementById('visualizer-canvas');
  const recordGuideBubble = document.getElementById('record-guide-bubble');
  const metricsPanel = document.getElementById('metrics-panel');
  const metricEngine = document.getElementById('metric-engine');
  const metricLatency = document.getElementById('metric-latency');
  const metricConfidence = document.getElementById('metric-confidence');
  const metricDuration = document.getElementById('metric-duration');
  const btnEndSession = document.getElementById('btn-end-session');
  const btnNewSession = document.getElementById('btn-new-session');

  // Video DOM
  const videoSection = document.getElementById('video-section');
  const videoImageInput = document.getElementById('video-image-input');
  const videoGender = document.getElementById('video-gender');
  const btnGenerateVideo = document.getElementById('btn-generate-video');
  const videoStatusEl = document.getElementById('video-status');
  const videoProgressFill = document.getElementById('video-progress-fill');
  const videoResult = document.getElementById('video-result');
  const videoSpeaking = document.getElementById('video-speaking');
  const videoListening = document.getElementById('video-listening');

  // --- State ---
  let ws = null;
  let sessionId = null;
  let loggedInUserId = null;
  let audioContext = null;
  let analyserNode = null;
  let mediaStream = null;
  let pcmWorkletNode = null;
  let isRecording = false;
  let isSpeaking = false;
  let currentQuestion = null;
  let totalQuestions = 0;
  let questionIndex = 0;
  let animFrameId = null;
  let hasUserPressedRecordOnce = false;

  // --- Auth ---
  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }

  function hideLoginError() {
    loginError.style.display = 'none';
  }

  async function handleAuth(endpoint) {
    const userId = loginUserIdInput.value.trim();
    const password = loginPasswordInput.value;
    if (!userId || !password) {
      showLoginError('아이디와 비밀번호를 입력해주세요');
      return;
    }

    hideLoginError();
    btnLogin.disabled = true;
    btnRegister.disabled = true;

    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '요청 실패');

      loggedInUserId = data.userId;
      loginScreen.style.display = 'none';
      appEl.style.display = 'flex';
      userBadge.textContent = loggedInUserId;
      connectWebSocket();
    } catch (err) {
      showLoginError(err.message);
    } finally {
      btnLogin.disabled = false;
      btnRegister.disabled = false;
    }
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAuth('login');
  });

  btnRegister.addEventListener('click', () => {
    handleAuth('register');
  });

  btnLogout.addEventListener('click', () => {
    if (ws) ws.close();
    loggedInUserId = null;
    appEl.style.display = 'none';
    loginScreen.style.display = 'flex';
    loginUserIdInput.value = '';
    loginPasswordInput.value = '';
    hideLoginError();
  });

  // --- WebSocket (Deepgram 고정) ---
  function connectWebSocket() {
    if (ws) ws.close();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const userParam = loggedInUserId ? `&userId=${encodeURIComponent(loggedInUserId)}` : '';
    const wsUrl = `${protocol}//${location.host}?engine=deepgram${userParam}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnectionStatus(true);
      btnEndSession.disabled = false;
    };

    ws.onclose = () => setConnectionStatus(false);

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      setConnectionStatus(false);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    };
  }

  function setConnectionStatus(connected) {
    connectionStatus.textContent = connected ? '연결됨' : '연결 안됨';
    connectionStatus.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
  }

  // --- Server Message Handler ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'session_start':
        sessionId = msg.session_id;
        sessionIdEl.textContent = sessionId.slice(0, 8) + '...';
        totalQuestions = msg.max_turns || 10;
        questionIndex = 0;
        currentQuestion = msg.question;
        updateProgress(msg.turn || 1, totalQuestions);
        chatMessages.innerHTML = '';
        addChatBubble('agent', msg.question.text);
        speakThenReady(msg.question.text);
        break;

      case 'transcript_interim':
        liveTranscriptSection.style.display = 'block';
        liveTranscript.textContent = msg.full_text
          ? msg.full_text + ' ' + msg.text
          : msg.text;
        break;

      case 'transcript_partial_final':
        liveTranscriptSection.style.display = 'block';
        liveTranscript.textContent = msg.full_text || msg.text;
        break;

      case 'transcript_final':
        console.log('[CLIENT] transcript_final received:', msg.text);
        liveTranscriptSection.style.display = 'none';
        if (msg.text) {
          finishRecording(msg.text, msg);
        }
        break;

      case 'agent_thinking':
        micLabel.textContent = '생각 중...';
        btnStart.disabled = true;
        break;

      case 'next_question':
        currentQuestion = msg.question;
        updateProgress(msg.turn || questionIndex + 1, msg.max_turns || totalQuestions);
        addChatBubble('agent', msg.question.text);
        speakThenReady(msg.question.text);
        break;

      case 'session_complete':
        showSessionComplete(msg.session);
        break;

      case 'transcript_rejected':
        liveTranscriptSection.style.display = 'none';
        setMicReady();
        break;

      case 'video_status': {
        videoStatusEl.style.display = 'block';
        const statusMap = {
          preprocessing: '당신의 모습을 미래로 다듬고 있어요.',
          uploading: '당신의 이미지를 불러오고 있어요.',
          generating: '당신의 미래 자아를 호출하고 있어요.',
        };
        videoStatusEl.querySelector('.video-status-text').textContent = statusMap[msg.status] || msg.status;
        break;
      }

      case 'video_progress': {
        const pct = msg.total > 0 ? Math.round((msg.finished / msg.total) * 100) : 0;
        videoProgressFill.style.width = `${pct}%`;
        videoStatusEl.querySelector('.video-status-text').textContent = `비디오 생성 중... (${msg.finished}/${msg.total} 노드)`;
        break;
      }

      case 'video_complete':
        videoStatusEl.style.display = 'none';
        videoResult.style.display = 'block';
        if (msg.speakingUrl) videoSpeaking.src = msg.speakingUrl;
        if (msg.listeningUrl) videoListening.src = msg.listeningUrl;
        btnGenerateVideo.disabled = false;
        btnGenerateVideo.textContent = '비디오 생성';
        addSystemMessage('10년 뒤 미래에서 온 당신이 RoF Studio에서 기다리고 있어요. Studio로 입장해 주세요.');
        break;

      case 'error':
        console.error('[Server]', msg.message);
        addSystemMessage(`오류: ${msg.message}`);
        if (btnGenerateVideo) {
          btnGenerateVideo.disabled = false;
          btnGenerateVideo.textContent = '비디오 생성';
        }
        break;
    }
  }

  // --- TTS 재생 → 마이크 활성화 ---
  function speakThenReady(text) {
    btnStart.disabled = true;
    micLabel.textContent = '발화 중...';
    btnStart.classList.remove('recording');
    btnStart.classList.add('speaking');
    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;

    const voices = speechSynthesis.getVoices();
    const koVoice = voices.find(v => v.lang.startsWith('ko'));
    if (koVoice) utterance.voice = koVoice;

    utterance.onend = () => {
      isSpeaking = false;
      btnStart.classList.remove('speaking');
      setMicReady();
    };

    utterance.onerror = () => {
      isSpeaking = false;
      btnStart.classList.remove('speaking');
      setMicReady();
    };

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  function setMicReady() {
    btnStart.disabled = false;
    micLabel.textContent = '꾹 눌러서 말하기';
    if (!hasUserPressedRecordOnce && recordGuideBubble) {
      recordGuideBubble.classList.add('visible');
      recordGuideBubble.setAttribute('aria-hidden', 'false');
    }
  }

  // --- Push-to-Talk: mousedown/touchstart → 녹음, mouseup/touchend → 종료 ---
  function dismissRecordGuide() {
    if (hasUserPressedRecordOnce) return;
    hasUserPressedRecordOnce = true;
    if (recordGuideBubble) {
      recordGuideBubble.classList.remove('visible');
      recordGuideBubble.setAttribute('aria-hidden', 'true');
    }
  }

  btnStart.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dismissRecordGuide();
    if (!btnStart.disabled && !isRecording) startRecording();
  });

  btnStart.addEventListener('touchstart', (e) => {
    e.preventDefault();
    dismissRecordGuide();
    if (!btnStart.disabled && !isRecording) startRecording();
  });

  window.addEventListener('mouseup', () => {
    if (isRecording) stopRecording();
  });

  window.addEventListener('touchend', () => {
    if (isRecording) stopRecording();
  });

  // --- Start Recording ---
  async function startRecording() {
    if (isRecording) return;

    try {
      // Deepgram 세션을 먼저 생성 요청 (오디오보다 먼저 도착해야 함)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'start_recording' }));
        console.log('[CLIENT] start_recording sent');
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioContext.createMediaStreamSource(mediaStream);

      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);

      await audioContext.audioWorklet.addModule('pcm-processor.js');
      pcmWorkletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      pcmWorkletNode.port.onmessage = (e) => {
        if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(e.data);
      };
      source.connect(pcmWorkletNode);
      pcmWorkletNode.connect(audioContext.destination);

      isRecording = true;
      btnStart.classList.add('recording');
      micLabel.textContent = '녹음 중...';
      liveTranscript.textContent = '';
      liveTranscriptSection.style.display = 'block';

      drawVisualizer();
    } catch (err) {
      console.error('[Mic] Access denied:', err);
      addSystemMessage('마이크 접근 권한이 필요합니다');
    }
  }

  // --- Stop Recording ---
  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    btnStart.classList.remove('recording');
    micLabel.textContent = '처리 중...';
    btnStart.disabled = true;

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }

    if (pcmWorkletNode) {
      pcmWorkletNode.disconnect();
      pcmWorkletNode = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop_recording' }));
      console.log('[CLIENT] stop_recording sent');
    }
  }

  // --- Finish (전사 완료 → 다음 질문) ---
  function finishRecording(text, metadata) {
    addChatBubble('user', text, metadata);
    updateMetrics(metadata);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'save_answer',
        text,
        latency_ms: metadata.latency_ms,
        confidence: metadata.confidence,
        audio_duration_sec: metadata.audio_duration_sec,
      }));
    }
  }

  // --- Audio Visualizer ---
  function drawVisualizer() {
    if (!analyserNode) return;

    const ctx = visualizerCanvas.getContext('2d');
    const freqLength = analyserNode.frequencyBinCount;
    const freqData = new Uint8Array(freqLength);
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;

    function draw() {
      if (!isRecording) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      animFrameId = requestAnimationFrame(draw);

      analyserNode.getByteFrequencyData(freqData);

      ctx.fillStyle = 'rgba(15, 17, 23, 0.85)';
      ctx.fillRect(0, 0, width, height);

      const barWidth = (width / freqLength) * 2.5;
      let x = 0;

      for (let i = 0; i < freqLength; i++) {
        const barHeight = (freqData[i] / 255) * height;
        const alpha = 0.4 + (freqData[i] / 255) * 0.6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#13d8aa';
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
      ctx.globalAlpha = 1;
    }

    draw();
  }

  // --- UI Utilities ---
  function addChatBubble(role, text, metadata = null) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    const label = document.createElement('div');
    label.className = 'bubble-label';
    label.textContent = role === 'agent' ? 'Agent' : 'You';
    bubble.appendChild(label);

    const content = document.createElement('div');
    content.textContent = text;
    bubble.appendChild(content);

    chatMessages.appendChild(bubble);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-bubble agent';
    div.style.background = 'rgba(231, 76, 60, 0.15)';
    div.style.borderColor = 'var(--danger)';

    const content = document.createElement('div');
    content.textContent = text;
    div.appendChild(content);

    chatMessages.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function updateProgress(current, total) {
    const pct = Math.min((current / total) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `대화 ${current} / ${total}`;
  }

  function updateMetrics(data) {
    if (!metricsPanel) return;
    metricsPanel.style.display = 'block';
    if (metricEngine) {
      metricEngine.textContent = 'Deepgram';
      metricEngine.style.color = 'var(--accent-dg)';
    }
    if (metricLatency) metricLatency.textContent = data.latency_ms ? `${data.latency_ms} ms` : '- ms';
    if (metricConfidence) metricConfidence.textContent = data.confidence
      ? `${(data.confidence * 100).toFixed(1)}%` : 'N/A';
    if (metricDuration) metricDuration.textContent = data.audio_duration_sec
      ? `${data.audio_duration_sec.toFixed(1)} sec` : '- sec';
  }

  // --- Session Complete ---
  function showSessionComplete(sessionData) {
    btnStart.disabled = true;
    micLabel.textContent = '완료';
    btnEndSession.style.display = 'none';
    btnNewSession.style.display = 'inline-block';

    const banner = document.createElement('div');
    banner.className = 'session-complete-banner';
    banner.innerHTML = `
      <h3>대화가 완료되었습니다</h3>
      <p>총 ${sessionData.conversation.length}개의 대화가 기록되었습니다.</p>
      <p style="margin-top: 4px; font-family: monospace; font-size: 0.75rem;">
        세션: ${sessionData.session_id}
      </p>
    `;
    chatMessages.appendChild(banner);
    conversation.scrollTop = conversation.scrollHeight;

    // 비디오 생성 UI 표시
    if (videoSection) {
      videoSection.style.display = 'block';
      videoResult.style.display = 'none';
      videoStatusEl.style.display = 'none';
    }
  }

  // --- End / New Session ---
  btnEndSession.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (isRecording) stopRecording();
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  });

  btnNewSession.addEventListener('click', () => {
    btnNewSession.style.display = 'none';
    btnEndSession.style.display = 'inline-block';
    btnEndSession.disabled = true;
    chatMessages.innerHTML = '';
    metricsPanel.style.display = 'none';
    liveTranscriptSection.style.display = 'none';
    hasUserPressedRecordOnce = false;
    connectWebSocket();
  });

  // --- Video Generation ---
  if (videoImageInput) {
    videoImageInput.addEventListener('change', () => {
      btnGenerateVideo.disabled = !videoImageInput.files.length;
    });
  }

  if (btnGenerateVideo) {
    btnGenerateVideo.addEventListener('click', async () => {
      const file = videoImageInput?.files[0];
      if (!file || !ws || ws.readyState !== WebSocket.OPEN) return;

      btnGenerateVideo.disabled = true;
      btnGenerateVideo.textContent = '처리 중...';
      videoResult.style.display = 'none';
      videoProgressFill.style.width = '0%';

      const arrayBuffer = await file.arrayBuffer();
      ws.send(JSON.stringify({
        type: 'generate_video',
        userId: loggedInUserId || sessionId,
        gender: videoGender.value,
        fileBuffer: Array.from(new Uint8Array(arrayBuffer)),
      }));
    });
  }

  // Chrome voice list
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
  }

  // --- Init ---
  // 로그인 후 connectWebSocket() 호출됨
})();
