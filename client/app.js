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

  // --- Profile DOM ---
  const profileScreen = document.getElementById('profile-screen');
  const profileForm = document.getElementById('profile-form');
  const profileNameInput = document.getElementById('profile-name');
  const profileBirthdateInput = document.getElementById('profile-birthdate');
  const profileBirthtimeInput = document.getElementById('profile-birthtime');

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
  const btnEndSession = document.getElementById('btn-end-session');

  // Voice UI DOM
  const orbCanvas = document.getElementById('orb-canvas');
  const orbGlow = document.getElementById('orb-glow');
  const voiceStatusText = document.getElementById('voice-status-text');
  const voiceSubtitle = document.getElementById('voice-subtitle');

  // Video DOM
  const videoSection = document.getElementById('video-section');
  const videoImageInput = document.getElementById('video-image-input');
  const videoImageLabelText = document.getElementById('video-image-label-text');
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
  let userProfile = { name: '', gender: 'female', birthDateTime: '' };
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

  // --- Orb Animation State ---
  let orbAnimId = null;
  let orbState = 'idle'; // idle | speaking | recording | processing
  let orbTime = 0;
  let orbAudioData = null; // Float32 frequency data for recording visualization

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
      profileScreen.style.display = 'flex';
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
    userProfile = { name: '', gender: 'female', birthDateTime: '' };
    appEl.style.display = 'none';
    profileScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    loginUserIdInput.value = '';
    loginPasswordInput.value = '';
    hideLoginError();
    stopOrbAnimation();
  });

  // --- Profile Setup ---
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = profileNameInput.value.trim();
    const gender = document.querySelector('input[name="profile-gender"]:checked').value;
    const birthDate = profileBirthdateInput.value;
    const birthTime = profileBirthtimeInput.value || '';

    if (!name || !birthDate) return;

    userProfile = {
      name,
      gender,
      birthDateTime: birthTime ? `${birthDate}T${birthTime}` : birthDate,
    };

    profileScreen.style.display = 'none';
    appEl.style.display = 'flex';
    userBadge.textContent = `${name} (${loggedInUserId})`;
    connectWebSocket();
    startOrbAnimation();
  });

  // --- WebSocket ---
  function connectWebSocket() {
    if (ws) ws.close();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ engine: 'deepgram' });
    if (loggedInUserId) params.set('userId', loggedInUserId);
    if (userProfile.name) params.set('userName', userProfile.name);
    if (userProfile.gender) params.set('gender', userProfile.gender);
    if (userProfile.birthDateTime) params.set('birthDateTime', userProfile.birthDateTime);
    const wsUrl = `${protocol}//${location.host}?${params.toString()}`;

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
    connectionStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  }

  // --- Server Message Handler ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'session_start':
        sessionId = msg.session_id;
        if (sessionIdEl) sessionIdEl.textContent = sessionId.slice(0, 8) + '...';
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
        setOrbState('processing');
        voiceStatusText.textContent = '';
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
          preprocessing: '미래의 당신을 불러오고 있어요. 5분 뒤 RoF Studio에 방문해 주세요.',
          uploading: '미래의 당신을 불러오고 있어요. 5분 뒤 RoF Studio에 방문해 주세요.',
          generating: '미래의 당신을 불러오고 있어요. 5분 뒤 RoF Studio에 방문해 주세요.',
        };
        videoStatusEl.querySelector('.video-status-text').textContent = statusMap[msg.status] || msg.status;
        break;
      }

      case 'video_progress': {
        const pct = msg.total > 0 ? Math.round((msg.finished / msg.total) * 100) : 0;
        videoProgressFill.style.width = `${pct}%`;
        videoStatusEl.querySelector('.video-status-text').textContent = `4분 뒤 RoF Studio에 방문해 주세요....`;
        break;
      }

      case 'video_complete':
        videoStatusEl.style.display = 'none';
        videoResult.style.display = 'block';
        if (msg.speakingUrl) videoSpeaking.src = msg.speakingUrl;
        if (msg.listeningUrl) videoListening.src = msg.listeningUrl;
        btnGenerateVideo.disabled = false;
        btnGenerateVideo.classList.remove('btn-video-loading');
        voiceStatusText.textContent = 'RoF Studio에서 기다리고 있어요';
        break;

      case 'error':
        console.error('[Server]', msg.message);
        voiceStatusText.textContent = msg.message;
        voiceStatusText.style.color = 'var(--danger)';
        setTimeout(() => { voiceStatusText.style.color = ''; }, 3000);
        if (btnGenerateVideo) {
          btnGenerateVideo.disabled = false;
          btnGenerateVideo.classList.remove('btn-video-loading');
        }
        break;
    }
  }

  // --- TTS ---
  const TTS_SAMPLE_RATE = 24000;
  let ttsAudioCtx = null;
  let ttsAbortCtrl = null;

  async function speakThenReady(text) {
    btnStart.disabled = true;
    micLabel.textContent = '';
    btnStart.classList.remove('recording');
    btnStart.classList.add('speaking');
    isSpeaking = true;
    setOrbState('speaking');

    if (ttsAbortCtrl) ttsAbortCtrl.abort();
    if (ttsAudioCtx) { ttsAudioCtx.close(); ttsAudioCtx = null; }

    ttsAbortCtrl = new AbortController();
    ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: TTS_SAMPLE_RATE,
    });

    // Create analyser for orb visualization during TTS
    const ttsAnalyser = ttsAudioCtx.createAnalyser();
    ttsAnalyser.fftSize = 256;
    ttsAnalyser.smoothingTimeConstant = 0.7;

    const gainNode = ttsAudioCtx.createGain();
    gainNode.connect(ttsAnalyser);
    ttsAnalyser.connect(ttsAudioCtx.destination);

    // Feed TTS analyser data to orb
    orbAudioData = new Float32Array(ttsAnalyser.frequencyBinCount);
    const updateTtsData = () => {
      if (!isSpeaking) return;
      ttsAnalyser.getFloatFrequencyData(orbAudioData);
      requestAnimationFrame(updateTtsData);
    };
    updateTtsData();

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ttsAbortCtrl.signal,
      });
      if (!res.ok) throw new Error('TTS 요청 실패');

      const reader = res.body.getReader();
      let scheduledTime = ttsAudioCtx.currentTime;
      let lastSource = null;
      let leftover = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        let pcm = value;
        if (leftover) {
          const merged = new Uint8Array(leftover.length + pcm.length);
          merged.set(leftover);
          merged.set(pcm, leftover.length);
          pcm = merged;
          leftover = null;
        }
        if (pcm.length % 2 !== 0) {
          leftover = pcm.slice(-1);
          pcm = pcm.slice(0, -1);
        }
        if (pcm.length === 0) continue;

        const sampleCount = pcm.length / 2;
        const float32 = new Float32Array(sampleCount);
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i < sampleCount; i++) {
          float32[i] = view.getInt16(i * 2, true) / 32768;
        }

        const buf = ttsAudioCtx.createBuffer(1, sampleCount, TTS_SAMPLE_RATE);
        buf.getChannelData(0).set(float32);

        const src = ttsAudioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        src.start(scheduledTime);
        scheduledTime += buf.duration;
        lastSource = src;
      }

      const FADE_OUT_SEC = 0.08;
      gainNode.gain.setValueAtTime(1, Math.max(0, scheduledTime - FADE_OUT_SEC));
      gainNode.gain.linearRampToValueAtTime(0, scheduledTime);

      if (lastSource) {
        lastSource.onended = () => {
          isSpeaking = false;
          orbAudioData = null;
          btnStart.classList.remove('speaking');
          if (ttsAudioCtx) { ttsAudioCtx.close(); ttsAudioCtx = null; }
          setMicReady();
        };
      } else {
        isSpeaking = false;
        orbAudioData = null;
        btnStart.classList.remove('speaking');
        setMicReady();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[TTS] 스트리밍 재생 실패:', err);
      }
      isSpeaking = false;
      orbAudioData = null;
      btnStart.classList.remove('speaking');
      if (ttsAudioCtx) { ttsAudioCtx.close(); ttsAudioCtx = null; }
      setMicReady();
    }
  }

  function setMicReady() {
    btnStart.disabled = false;
    micLabel.textContent = '';
    setOrbState('idle');
    voiceStatusText.textContent = '';
    voiceSubtitle.textContent = '';

    if (!hasUserPressedRecordOnce && recordGuideBubble) {
      recordGuideBubble.classList.add('visible');
      recordGuideBubble.setAttribute('aria-hidden', 'false');
    }
  }

  // --- Push-to-Talk ---
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
      analyserNode.smoothingTimeConstant = 0.7;
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
      micLabel.textContent = '';
      liveTranscript.textContent = '';
      liveTranscriptSection.style.display = 'block';
      setOrbState('recording');

      // Feed mic analyser data to orb
      orbAudioData = new Float32Array(analyserNode.frequencyBinCount);
      drawVisualizer();
    } catch (err) {
      console.error('[Mic] Access denied:', err);
      voiceStatusText.textContent = '마이크 접근 권한이 필요합니다';
    }
  }

  // --- Stop Recording ---
  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    btnStart.classList.remove('recording');
    micLabel.textContent = '';
    btnStart.disabled = true;
    setOrbState('processing');

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

    orbAudioData = null;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop_recording' }));
      console.log('[CLIENT] stop_recording sent');
    }
  }

  // --- Finish ---
  function finishRecording(text, metadata) {
    addChatBubble('user', text, metadata);

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

  // --- Audio Visualizer (hidden canvas, data used by orb) ---
  function drawVisualizer() {
    if (!analyserNode) return;

    function draw() {
      if (!isRecording) return;
      animFrameId = requestAnimationFrame(draw);
      if (analyserNode && orbAudioData) {
        analyserNode.getFloatFrequencyData(orbAudioData);
      }
    }
    draw();
  }

  // --- UI Utilities ---
  function addChatBubble(role, text, metadata = null) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    const content = document.createElement('div');
    content.textContent = text;
    bubble.appendChild(content);
    chatMessages.appendChild(bubble);
  }

  function updateProgress(current, total) {
    const pct = Math.min((current / total) * 100, 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    progressText.textContent = `${current} / ${total}`;
  }

  // --- Session Complete ---
  function showSessionComplete(sessionData) {
    btnStart.disabled = true;
    micLabel.textContent = '';
    btnEndSession.style.display = 'none';
    setOrbState('idle');
    voiceStatusText.textContent = '대화가 종료되었습니다';
    voiceSubtitle.textContent = '';

    if (videoSection) {
      videoSection.style.display = 'block';
      videoResult.style.display = 'none';
      videoStatusEl.style.display = 'none';
    }
  }

  // --- End Session ---
  btnEndSession.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (isRecording) stopRecording();
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  });

  // --- Video Generation ---
  if (videoImageInput) {
    videoImageInput.addEventListener('change', () => {
      const hasFile = !!videoImageInput.files.length;
      btnGenerateVideo.disabled = !hasFile;
      if (videoImageLabelText) {
        videoImageLabelText.textContent = hasFile
          ? (videoImageInput.files[0]?.name || 'Image selected')
          : '프로필 이미지 선택';
      }
    });
  }

  if (btnGenerateVideo) {
    btnGenerateVideo.addEventListener('click', async () => {
      const file = videoImageInput?.files[0];
      if (!file || !ws || ws.readyState !== WebSocket.OPEN) return;

      btnGenerateVideo.disabled = true;
      btnGenerateVideo.classList.add('btn-video-loading');
      videoResult.style.display = 'none';
      videoProgressFill.style.width = '0%';

      const arrayBuffer = await file.arrayBuffer();
      ws.send(JSON.stringify({
        type: 'generate_video',
        userId: loggedInUserId || sessionId,
        gender: userProfile.gender,
        fileBuffer: Array.from(new Uint8Array(arrayBuffer)),
      }));
    });
  }

  // ═══════════════════════════════════════
  // ORB ANIMATION
  // ═══════════════════════════════════════

  function setOrbState(state) {
    orbState = state;
    orbGlow.className = 'orb-glow' + (state !== 'idle' ? ` ${state}` : '');
  }

  function startOrbAnimation() {
    if (orbAnimId) return;
    const ctx = orbCanvas.getContext('2d');
    const w = orbCanvas.width;
    const h = orbCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    function animate() {
      orbAnimId = requestAnimationFrame(animate);
      orbTime += 0.016; // ~60fps
      ctx.clearRect(0, 0, w, h);

      // Get audio energy
      let energy = 0;
      if (orbAudioData) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < orbAudioData.length; i++) {
          // Float frequency data is in dB (negative values, -100 to 0)
          const db = orbAudioData[i];
          const normalized = Math.max(0, (db + 100) / 100);
          sum += normalized;
          count++;
        }
        energy = count > 0 ? sum / count : 0;
        energy = Math.min(energy, 1);
      }

      switch (orbState) {
        case 'idle':
          drawIdleOrb(ctx, cx, cy, orbTime);
          break;
        case 'speaking':
          drawSpeakingOrb(ctx, cx, cy, orbTime, energy);
          break;
        case 'recording':
          drawRecordingOrb(ctx, cx, cy, orbTime, energy);
          break;
        case 'processing':
          drawProcessingOrb(ctx, cx, cy, orbTime);
          break;
      }
    }
    animate();
  }

  function stopOrbAnimation() {
    if (orbAnimId) {
      cancelAnimationFrame(orbAnimId);
      orbAnimId = null;
    }
  }

  // --- Idle: gentle breathing orb ---
  function drawIdleOrb(ctx, cx, cy, t) {
    const baseR = 60;
    const breathe = Math.sin(t * 0.8) * 4;
    const r = baseR + breathe;

    // Outer glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.8);
    grad.addColorStop(0, 'rgba(108, 92, 231, 0.08)');
    grad.addColorStop(1, 'rgba(108, 92, 231, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Main orb with subtle distortion
    drawBlobOrb(ctx, cx, cy, r, t, 0.3, [
      { r: 108, g: 92, b: 231, a: 0.6 },
      { r: 90, g: 80, b: 200, a: 0.3 },
    ]);
  }

  // --- Speaking: dynamic teal orb responding to TTS audio ---
  function drawSpeakingOrb(ctx, cx, cy, t, energy) {
    const baseR = 65;
    const audioBoost = energy * 30;
    const r = baseR + audioBoost + Math.sin(t * 1.2) * 3;

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2);
    grad.addColorStop(0, `rgba(19, 216, 170, ${0.12 + energy * 0.15})`);
    grad.addColorStop(0.5, `rgba(19, 216, 170, ${0.04 + energy * 0.06})`);
    grad.addColorStop(1, 'rgba(19, 216, 170, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Ripple rings
    const rippleCount = 3;
    for (let i = 0; i < rippleCount; i++) {
      const phase = (t * 1.5 + i * 2.1) % 6;
      const rippleR = r + phase * 15;
      const alpha = Math.max(0, 0.15 - phase * 0.025) * (0.5 + energy);
      ctx.strokeStyle = `rgba(19, 216, 170, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Main orb
    drawBlobOrb(ctx, cx, cy, r, t * 1.5, 0.5 + energy * 0.8, [
      { r: 19, g: 216, b: 170, a: 0.7 },
      { r: 13, g: 180, b: 150, a: 0.4 },
    ]);
  }

  // --- Recording: purple responsive orb ---
  function drawRecordingOrb(ctx, cx, cy, t, energy) {
    const baseR = 60;
    const audioBoost = energy * 35;
    const r = baseR + audioBoost;

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2);
    grad.addColorStop(0, `rgba(108, 92, 231, ${0.15 + energy * 0.2})`);
    grad.addColorStop(0.6, `rgba(108, 92, 231, ${0.05 + energy * 0.08})`);
    grad.addColorStop(1, 'rgba(108, 92, 231, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
    ctx.fill();

    // Audio wave ring
    if (energy > 0.05 && orbAudioData) {
      ctx.save();
      ctx.strokeStyle = `rgba(108, 92, 231, ${0.3 + energy * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const points = 64;
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const freqIdx = Math.floor((i / points) * orbAudioData.length);
        const db = orbAudioData[freqIdx] || -100;
        const amp = Math.max(0, (db + 100) / 100) * 20;
        const pr = r + 15 + amp;
        const x = cx + Math.cos(angle) * pr;
        const y = cy + Math.sin(angle) * pr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Main orb
    drawBlobOrb(ctx, cx, cy, r, t * 2, 0.6 + energy * 1.0, [
      { r: 108, g: 92, b: 231, a: 0.8 },
      { r: 140, g: 100, b: 255, a: 0.4 },
    ]);
  }

  // --- Processing: spinning orb ---
  function drawProcessingOrb(ctx, cx, cy, t) {
    const baseR = 55;
    const r = baseR + Math.sin(t * 2) * 3;

    // Spinning arc
    ctx.save();
    const arcStart = t * 3;
    const arcLen = Math.PI * 1.2;
    ctx.strokeStyle = 'rgba(108, 92, 231, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 20, arcStart, arcStart + arcLen);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(19, 216, 170, 0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 28, -arcStart * 0.7, -arcStart * 0.7 + arcLen * 0.8);
    ctx.stroke();
    ctx.restore();

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.6);
    grad.addColorStop(0, 'rgba(108, 92, 231, 0.1)');
    grad.addColorStop(1, 'rgba(108, 92, 231, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Main orb (dimmer)
    drawBlobOrb(ctx, cx, cy, r, t, 0.4, [
      { r: 108, g: 92, b: 231, a: 0.4 },
      { r: 80, g: 70, b: 180, a: 0.2 },
    ]);
  }

  // --- Blob orb drawing helper ---
  function drawBlobOrb(ctx, cx, cy, radius, t, distortion, colors) {
    const points = 120;
    ctx.save();

    // Create blob path
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const n1 = Math.sin(angle * 3 + t * 1.2) * distortion * 6;
      const n2 = Math.sin(angle * 5 - t * 0.8) * distortion * 3;
      const n3 = Math.cos(angle * 2 + t * 1.5) * distortion * 4;
      const r = radius + n1 + n2 + n3;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill with gradient
    const grad = ctx.createRadialGradient(
      cx - radius * 0.3, cy - radius * 0.3, radius * 0.1,
      cx, cy, radius * 1.2
    );
    const c1 = colors[0];
    const c2 = colors[1];
    grad.addColorStop(0, `rgba(${c1.r}, ${c1.g}, ${c1.b}, ${c1.a})`);
    grad.addColorStop(0.6, `rgba(${c2.r}, ${c2.g}, ${c2.b}, ${c2.a})`);
    grad.addColorStop(1, `rgba(${c2.r}, ${c2.g}, ${c2.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle inner highlight
    const highlight = ctx.createRadialGradient(
      cx - radius * 0.2, cy - radius * 0.3, 0,
      cx, cy, radius * 0.8
    );
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlight;
    ctx.fill();

    ctx.restore();
  }

  // --- Init ---
})();
