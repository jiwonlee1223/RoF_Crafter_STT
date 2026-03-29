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

  // --- Gender DOM (login screen) ---
  const loginGenderInputs = () => document.querySelector('input[name="login-gender"]:checked');

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
  const voiceMain = document.querySelector('.voice-main');
  const orbCanvas = document.getElementById('orb-canvas');
  const orbGlow = document.getElementById('orb-glow');
  const voiceStatusText = document.getElementById('voice-status-text');
  const summarySpinner = document.getElementById('summary-spinner');
  const voiceSubtitle = document.getElementById('voice-subtitle');

  // Video DOM
  const videoSection = document.getElementById('video-section');
  const videoImageInput = document.getElementById('video-image-input');
  const videoImageLabelText = document.getElementById('video-image-label-text');
  const btnGenerateVideo = document.getElementById('btn-generate-video');
  const videoStatusEl = document.getElementById('video-status');
  const videoResult = document.getElementById('video-result');

  // Camera DOM
  const btnOpenCamera = document.getElementById('btn-open-camera');
  const cameraModal = document.getElementById('camera-modal');
  const cameraPreview = document.getElementById('camera-preview');
  const cameraCaptureCanvas = document.getElementById('camera-capture-canvas');
  const cameraCapturedImg = document.getElementById('camera-captured-img');
  const btnCameraCapture = document.getElementById('btn-camera-capture');
  const btnCameraClose = document.getElementById('btn-camera-close');
  const btnCameraRetake = document.getElementById('btn-camera-retake');
  const btnCameraConfirm = document.getElementById('btn-camera-confirm');

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
  let pendingClosing = false;
  let capturedImageFile = null; // File from camera capture
  let personaReady = false;
  let cameraStream = null;
  let currentQuestion = null;
  let totalQuestions = 0;
  let questionIndex = 0;
  let animFrameId = null;
  let hasUserPressedRecordOnce = false;
  let typewriterTimer = null;

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
      showLoginError('이름과 생년월일을 입력해주세요');
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

      // 로그인 화면에서 이름, 생년월일, 성별을 바로 추출
      const loginName = loginUserIdInput.value.trim();
      const loginBirth = loginPasswordInput.value.trim();
      const loginGender = loginGenderInputs().value;

      // 생년월일 6자리 → YYYY-MM-DD 변환
      const yy = parseInt(loginBirth.substring(0, 2), 10);
      const mm = loginBirth.substring(2, 4);
      const dd = loginBirth.substring(4, 6);
      const yyyy = yy >= 50 ? `19${loginBirth.substring(0, 2)}` : `20${loginBirth.substring(0, 2)}`;
      const birthDate = `${yyyy}-${mm}-${dd}`;

      userProfile = {
        name: loginName,
        gender: loginGender,
        birthDateTime: birthDate,
      };

      loginScreen.style.display = 'none';
      appEl.style.display = 'flex';
      userBadge.textContent = `${loginName} (${loggedInUserId})`;
      connectWebSocket();
      startOrbAnimation();
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
    loginScreen.style.display = 'flex';
    loginUserIdInput.value = '';
    loginPasswordInput.value = '';
    hideLoginError();
    stopOrbAnimation();
  });

  // --- Profile setup removed: login screen now collects all info ---

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
        stopTypewriter();
        voiceStatusText.textContent = '';
        btnStart.disabled = true;
        break;

      case 'next_question':
        currentQuestion = msg.question;
        updateProgress(msg.turn || questionIndex + 1, msg.max_turns || totalQuestions);
        addChatBubble('agent', msg.question.text);
        speakThenReady(msg.question.text);
        break;

      case 'closing_remark':
        pendingClosing = true;
        addChatBubble('agent', msg.question.text);
        speakThenReady(msg.question.text);
        break;

      case 'session_complete':
        showSessionComplete(msg.session);
        break;

      case 'conversation_summary':
        console.log('[CLIENT] conversation_summary received:', msg.text?.slice(0, 60));
        startSummaryTypingAnimation(msg.text);
        break;

      case 'persona_ready':
        personaReady = true;
        summarySpinner.classList.remove('visible');
        updateVideoButtonState();
        restoreSummary();
        // 비디오 섹션 보이기 & 자동으로 카메라 열기
        if (videoSection) {
          videoSection.style.visibility = 'visible';
        }
        if (btnOpenCamera) {
          btnOpenCamera.click();
        }
        break;

      case 'transcript_rejected':
        liveTranscriptSection.style.display = 'none';
        addChatBubble('agent', '음, 잠시만요. 잘 들리지 않아요. 조금만 크게 이야기해주시겠어요?');
        speakThenReady('음, 잠시만요. 잘 들리지 않아요. 조금만 크게 이야기해주시겠어요?');
        break;

      case 'video_status': {
        videoStatusEl.style.display = 'block';
        const statusMap = {
          preprocessing: '미래의 당신을 불러오고 있어요.',
          uploading: '미래의 당신을 불러오고 있어요.',
          generating: '미래의 당신을 불러오고 있어요.',
        };
        videoStatusEl.querySelector('.video-status-text').textContent = statusMap[msg.status] || msg.status;
        break;
      }

      case 'video_progress':
        break;

      case 'video_complete':
        videoStatusEl.style.display = 'none';
        videoResult.style.display = 'block';
        btnGenerateVideo.disabled = false;
        btnGenerateVideo.classList.remove('btn-video-loading');
        restoreSummary();
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

  // Mobile Safari: AudioContext must be created/resumed from a user gesture.
  // Call this on any user tap to ensure TTS audio will work.
  function ensureTtsAudioCtx() {
    if (!ttsAudioCtx || ttsAudioCtx.state === 'closed') {
      ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: TTS_SAMPLE_RATE,
      });
      console.log('[TTS] AudioContext created, sampleRate:', ttsAudioCtx.sampleRate, 'state:', ttsAudioCtx.state);
    }
    if (ttsAudioCtx.state === 'suspended') {
      console.log('[TTS] AudioContext suspended, resuming...');
      ttsAudioCtx.resume();
    }
    // iOS Safari: play a silent buffer to truly unlock audio output
    const silentBuf = ttsAudioCtx.createBuffer(1, 1, ttsAudioCtx.sampleRate);
    const silentSrc = ttsAudioCtx.createBufferSource();
    silentSrc.buffer = silentBuf;
    silentSrc.connect(ttsAudioCtx.destination);
    silentSrc.start();
    console.log('[TTS] AudioContext state:', ttsAudioCtx.state);
    return ttsAudioCtx;
  }

  // Pre-warm TTS AudioContext on any user interaction
  document.addEventListener('touchstart', () => {
    console.log('[TTS] touchstart → ensureTtsAudioCtx');
    ensureTtsAudioCtx();
  }, { once: true });
  document.addEventListener('click', () => {
    console.log('[TTS] click → ensureTtsAudioCtx');
    ensureTtsAudioCtx();
  }, { once: true });

  function stopTypewriter() {
    if (typewriterTimer) {
      cancelAnimationFrame(typewriterTimer);
      typewriterTimer = null;
    }
  }

  async function speakThenReady(text) {
    console.log('[TTS] speakThenReady called, text length:', text.length);
    btnStart.disabled = true;
    micLabel.textContent = '';
    btnStart.classList.remove('recording');
    btnStart.classList.add('speaking');
    isSpeaking = true;
    setOrbState('speaking');
    stopTypewriter();
    voiceStatusText.textContent = '';

    if (ttsAbortCtrl) ttsAbortCtrl.abort();

    ttsAbortCtrl = new AbortController();
    ensureTtsAudioCtx();
    console.log('[TTS] AudioContext state before fetch:', ttsAudioCtx.state);

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
      console.log('[TTS] fetch response status:', res.status);
      if (!res.ok) throw new Error('TTS 요청 실패: ' + res.status);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let audioStartAt = null;  // set on first audio chunk
      let scheduledTime = 0;
      let chunkCount = 0;
      let lastSource = null;
      let shownLen = 0;
      let ndjsonBuffer = '';

      // Character-level timestamps from ElevenLabs alignment data
      const charTimestamps = []; // [{ startTime }]

      // Process a single NDJSON line: extract alignment + schedule audio
      const processLine = (line) => {
        if (!line.trim()) return;
        let parsed;
        try { parsed = JSON.parse(line); }
        catch (e) { console.warn('[TTS] NDJSON parse error:', e.message); return; }

        // Collect character-level alignment
        if (parsed.alignment) {
          const chars = parsed.alignment.characters || [];
          const starts = parsed.alignment.character_start_times_seconds || [];
          for (let i = 0; i < chars.length; i++) {
            charTimestamps.push({ startTime: starts[i] || 0 });
          }
        }

        // Decode base64 audio → PCM → AudioBuffer
        if (!parsed.audio_base64) return;
        // Capture audioStartAt on first audio chunk (avoids fetch delay offset)
        if (audioStartAt === null) {
          audioStartAt = ttsAudioCtx.currentTime;
          scheduledTime = audioStartAt;
        }
        const binaryStr = atob(parsed.audio_base64);
        const usableLen = binaryStr.length - (binaryStr.length % 2);
        if (usableLen < 2) return;

        const pcm = new Uint8Array(usableLen);
        for (let i = 0; i < usableLen; i++) pcm[i] = binaryStr.charCodeAt(i);

        const sampleCount = usableLen / 2;
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
        chunkCount++;
      };

      // rAF loop: sync text reveal with character-level timestamps
      const syncText = () => {
        if (!isSpeaking) return;
        if (audioStartAt === null) {
          typewriterTimer = requestAnimationFrame(syncText);
          return;
        }
        const elapsed = ttsAudioCtx.currentTime - audioStartAt;

        if (charTimestamps.length > 0) {
          // Word-level sync using ElevenLabs alignment
          let visibleLen = 0;
          for (let i = 0; i < charTimestamps.length; i++) {
            if (elapsed >= charTimestamps[i].startTime) visibleLen = i + 1;
            else break;
          }
          const target = Math.min(visibleLen, text.length);
          if (target > shownLen) {
            voiceStatusText.textContent = text.slice(0, target);
            voiceStatusText.scrollTop = voiceStatusText.scrollHeight;
            shownLen = target;
          }
        } else {
          // Fallback: proportional sync (before alignment data arrives)
          const totalDur = scheduledTime - audioStartAt;
          if (totalDur > 0) {
            const progress = Math.min(elapsed / totalDur, 1);
            const target = Math.ceil(progress * text.length);
            if (target > shownLen) {
              voiceStatusText.textContent = text.slice(0, target);
              voiceStatusText.scrollTop = voiceStatusText.scrollHeight;
              shownLen = target;
            }
          }
        }
        typewriterTimer = requestAnimationFrame(syncText);
      };
      typewriterTimer = requestAnimationFrame(syncText);

      // Read NDJSON stream (each line: { audio_base64, alignment })
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          ndjsonBuffer += decoder.decode();
          break;
        }
        ndjsonBuffer += decoder.decode(value, { stream: true });

        const lines = ndjsonBuffer.split('\n');
        ndjsonBuffer = lines.pop();
        for (const line of lines) processLine(line);
      }
      // Process any remaining data in buffer
      if (ndjsonBuffer.trim()) processLine(ndjsonBuffer);
      console.log('[TTS] stream done, chunks:', chunkCount, 'duration:', scheduledTime - audioStartAt, 'alignments:', charTimestamps.length);

      const FADE_OUT_SEC = 0.08;
      gainNode.gain.setValueAtTime(1, Math.max(0, scheduledTime - FADE_OUT_SEC));
      gainNode.gain.linearRampToValueAtTime(0, scheduledTime);

      if (lastSource) {
        lastSource.onended = () => {
          stopTypewriter();
          voiceStatusText.textContent = text;
          isSpeaking = false;
          orbAudioData = null;
          btnStart.classList.remove('speaking');
          setMicReady();
        };
      } else {
        stopTypewriter();
        voiceStatusText.textContent = text;
        isSpeaking = false;
        orbAudioData = null;
        btnStart.classList.remove('speaking');
        setMicReady();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[TTS] 스트리밍 재생 실패:', err.name, err.message);
      } else {
        console.log('[TTS] aborted');
      }
      stopTypewriter();
      isSpeaking = false;
      orbAudioData = null;
      btnStart.classList.remove('speaking');
      setMicReady();
    }
  }

  function setMicReady() {
    // 마무리 멘트 TTS 재생 완료 → 세션 종료 요청
    if (pendingClosing) {
      pendingClosing = false;
      btnStart.disabled = true;
      ws.send(JSON.stringify({ type: 'end_session' }));
      return;
    }

    btnStart.disabled = false;
    micLabel.textContent = '';
    setOrbState('idle');
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
      liveTranscriptSection.style.display = 'none';
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
  let summaryTypingTimer = null;
  let savedSummaryHtml = null;
  function startSummaryTypingAnimation(fullText) {
    if (summaryTypingTimer) {
      clearTimeout(summaryTypingTimer);
      summaryTypingTimer = null;
    }
    // summary 모드: 오브 흐리게 + 텍스트 오버랩
    voiceMain.classList.add('summary-mode');

    // 문장 단위 줄바꿈 처리: 마침표+공백 → 마침표+줄바꿈, 기존 줄바꿈 유지
    const formatted = fullText.replace(/([.。])\s+/g, '$1\n');

    // 첫 줄(첫 번째 줄바꿈 기준)을 bold 처리
    const firstBreak = formatted.indexOf('\n');
    const boldEnd = firstBreak >= 0 ? firstBreak : formatted.length;

    let charIndex = 0;
    voiceStatusText.innerHTML = '';
    function tick() {
      if (charIndex <= formatted.length) {
        const visible = formatted.slice(0, charIndex);
        if (charIndex <= boldEnd) {
          voiceStatusText.innerHTML = '<strong>' + visible.replace(/\n/g, '<br>') + '</strong>';
        } else {
          voiceStatusText.innerHTML = '<strong>' + formatted.slice(0, boldEnd) + '</strong>' + visible.slice(boldEnd).replace(/\n/g, '<br>');
        }
        charIndex++;
        summaryTypingTimer = setTimeout(tick, 80);
      } else {
        // 타이핑 완료 — 최종 HTML 저장
        savedSummaryHtml = voiceStatusText.innerHTML;
        if (!personaReady) {
          summarySpinner.classList.add('visible');
        }
      }
    }
    tick();
  }

  function stopSummaryTypingAnimation() {
    if (summaryTypingTimer) {
      clearTimeout(summaryTypingTimer);
      summaryTypingTimer = null;
    }
  }

  function restoreSummary() {
    if (savedSummaryHtml) {
      voiceStatusText.innerHTML = savedSummaryHtml;
      voiceMain.classList.add('summary-mode');
    }
  }

  function showSessionComplete(sessionData) {
    btnStart.disabled = true;
    micLabel.textContent = '';
    btnEndSession.style.display = 'none';
    setOrbState('idle');
    voiceSubtitle.textContent = '';

    voiceStatusText.textContent = '';
    summarySpinner.classList.remove('visible');

    if (videoSection) {
      videoSection.style.display = 'block';
      videoSection.style.visibility = 'hidden'; // 페르소나 준비 전까지 숨김
      videoResult.style.display = 'none';
      videoStatusEl.style.display = 'none';
    }

    if (btnGenerateVideo) {
      btnGenerateVideo.classList.add('btn-video-preparing');
    }
  }

  function updateVideoButtonState() {
    if (btnGenerateVideo) {
      btnGenerateVideo.disabled = !(capturedImageFile && personaReady);
      if (personaReady) {
        btnGenerateVideo.classList.remove('btn-video-preparing');
      }
    }
  }

  // --- End Session ---
  btnEndSession.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (isRecording) stopRecording();
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  });

  // --- Camera Capture ---
  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    if (cameraPreview) cameraPreview.srcObject = null;
  }

  function showCameraLive() {
    cameraCapturedImg.style.display = 'none';
    cameraPreview.style.display = '';
    btnCameraCapture.style.display = '';
    btnCameraRetake.style.display = 'none';
    btnCameraConfirm.style.display = 'none';
  }

  function showCameraCaptured() {
    cameraPreview.style.display = 'none';
    cameraCapturedImg.style.display = '';
    btnCameraCapture.style.display = 'none';
    btnCameraRetake.style.display = '';
    btnCameraConfirm.style.display = '';
  }

  if (btnOpenCamera) {
    btnOpenCamera.addEventListener('click', async () => {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }
        });
        cameraPreview.srcObject = cameraStream;
        cameraModal.style.display = '';
        showCameraLive();
      } catch (err) {
        alert('카메라에 접근할 수 없습니다. 카메라 권한을 확인해주세요.');
        console.error('Camera access error:', err);
      }
    });
  }

  if (btnCameraCapture) {
    btnCameraCapture.addEventListener('click', () => {
      const video = cameraPreview;
      const size = Math.min(video.videoWidth, video.videoHeight);
      cameraCaptureCanvas.width = size;
      cameraCaptureCanvas.height = size;
      const ctx = cameraCaptureCanvas.getContext('2d');
      const offsetX = (video.videoWidth - size) / 2;
      const offsetY = (video.videoHeight - size) / 2;
      ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);
      cameraCapturedImg.src = cameraCaptureCanvas.toDataURL('image/jpeg', 0.9);
      showCameraCaptured();
    });
  }

  if (btnCameraRetake) {
    btnCameraRetake.addEventListener('click', () => {
      showCameraLive();
    });
  }

  if (btnCameraConfirm) {
    btnCameraConfirm.addEventListener('click', () => {
      cameraCaptureCanvas.toBlob((blob) => {
        capturedImageFile = new File([blob], 'profile-capture.jpg', { type: 'image/jpeg' });
        updateVideoButtonState();
        if (videoImageLabelText) {
          videoImageLabelText.textContent = '촬영 완료';
        }
        stopCamera();
        cameraModal.style.display = 'none';
        stopSummaryTypingAnimation();
        restoreSummary();

        // 페르소나 준비 완료 상태면 자동으로 comfy 호출
        if (personaReady && capturedImageFile && ws && ws.readyState === WebSocket.OPEN) {
          autoTriggerGenerateVideo();
        }
      }, 'image/jpeg', 0.9);
    });
  }

  if (btnCameraClose) {
    btnCameraClose.addEventListener('click', () => {
      stopCamera();
      cameraModal.style.display = 'none';
    });
  }

  // --- Auto-trigger video generation ---
  async function autoTriggerGenerateVideo() {
    const file = capturedImageFile;
    if (!file || !ws || ws.readyState !== WebSocket.OPEN) return;

    if (btnGenerateVideo) {
      btnGenerateVideo.disabled = true;
      btnGenerateVideo.classList.add('btn-video-loading');
    }
    videoResult.style.display = 'none';

    const arrayBuffer = await file.arrayBuffer();
    ws.send(JSON.stringify({
      type: 'generate_video',
      userId: loggedInUserId || sessionId,
      gender: userProfile.gender,
      fileBuffer: Array.from(new Uint8Array(arrayBuffer)),
    }));
    console.log('[CLIENT] Auto-triggered generate_video');
  }

  // --- Video Generation ---
  if (videoImageInput) {
    videoImageInput.addEventListener('change', () => {
      const hasFile = !!videoImageInput.files.length;
      if (hasFile) {
        capturedImageFile = videoImageInput.files[0];
        updateVideoButtonState();
        if (videoImageLabelText) {
          videoImageLabelText.textContent = videoImageInput.files[0]?.name || 'Image selected';
        }
      }
    });
  }

  if (btnGenerateVideo) {
    btnGenerateVideo.addEventListener('click', async () => {
      const file = capturedImageFile;
      if (!file || !ws || ws.readyState !== WebSocket.OPEN) return;

      btnGenerateVideo.disabled = true;
      btnGenerateVideo.classList.add('btn-video-loading');
      videoResult.style.display = 'none';
  
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
    grad.addColorStop(0, 'rgba(73, 73, 73, 0.08)');
    grad.addColorStop(1, 'rgba(73, 73, 73, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Main orb with subtle distortion
    drawBlobOrb(ctx, cx, cy, r, t, 0.3, [
      { r: 73, g: 73, b: 73, a: 0.6 },
      { r: 60, g: 60, b: 60, a: 0.3 },
    ]);
  }

  // --- Speaking: dynamic red orb responding to TTS audio ---
  function drawSpeakingOrb(ctx, cx, cy, t, energy) {
    const baseR = 65;
    const audioBoost = energy * 30;
    const r = baseR + audioBoost + Math.sin(t * 1.2) * 3;

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2);
    grad.addColorStop(0, `rgba(166, 26, 30, ${0.12 + energy * 0.15})`);
    grad.addColorStop(0.5, `rgba(166, 26, 30, ${0.04 + energy * 0.06})`);
    grad.addColorStop(1, 'rgba(166, 26, 30, 0)');
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
      ctx.strokeStyle = `rgba(166, 26, 30, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Main orb
    drawBlobOrb(ctx, cx, cy, r, t * 1.5, 0.5 + energy * 0.8, [
      { r: 166, g: 26, b: 30, a: 0.7 },
      { r: 140, g: 20, b: 24, a: 0.4 },
    ]);
  }

  // --- Recording: gray responsive orb ---
  function drawRecordingOrb(ctx, cx, cy, t, energy) {
    const baseR = 60;
    const audioBoost = energy * 35;
    const r = baseR + audioBoost;

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2);
    grad.addColorStop(0, `rgba(73, 73, 73, ${0.15 + energy * 0.2})`);
    grad.addColorStop(0.6, `rgba(73, 73, 73, ${0.05 + energy * 0.08})`);
    grad.addColorStop(1, 'rgba(73, 73, 73, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
    ctx.fill();

    // Audio wave ring
    if (energy > 0.05 && orbAudioData) {
      ctx.save();
      ctx.strokeStyle = `rgba(73, 73, 73, ${0.3 + energy * 0.3})`;
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
      { r: 73, g: 73, b: 73, a: 0.8 },
      { r: 90, g: 90, b: 90, a: 0.4 },
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
    ctx.strokeStyle = 'rgba(73, 73, 73, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 20, arcStart, arcStart + arcLen);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(166, 26, 30, 0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 28, -arcStart * 0.7, -arcStart * 0.7 + arcLen * 0.8);
    ctx.stroke();
    ctx.restore();

    // Glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.6);
    grad.addColorStop(0, 'rgba(73, 73, 73, 0.1)');
    grad.addColorStop(1, 'rgba(73, 73, 73, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Main orb (dimmer)
    drawBlobOrb(ctx, cx, cy, r, t, 0.4, [
      { r: 73, g: 73, b: 73, a: 0.4 },
      { r: 60, g: 60, b: 60, a: 0.2 },
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
