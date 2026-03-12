const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const COMFYUI_HOST = process.env.COMFYUI_HOST || 'http://143.248.107.38:8188';
const COMFYUI_WS = process.env.COMFYUI_WS || 'ws://143.248.107.38:8188/ws';
const UPLOAD_SERVER = process.env.COMFYUI_UPLOAD_SERVER || 'http://143.248.107.38:8185/upload/RoF_output';
const VIDEO_HOST = process.env.COMFYUI_VIDEO_HOST || 'http://143.248.107.38:8186';

const PROJECT = 'RoF_output';
const INPUT_FILENAME = 'input.jpg';

// 워크플로우 핵심 노드 ID
const SPEAKING_PROMPT_NODE = '135:93';
const LISTENING_PROMPT_NODE = '137:93';
const SPEAKING_VIDEO_SAVE_NODE = '134';
const LISTENING_VIDEO_SAVE_NODE = '136';
const VIDEO_NODE_IDS = [SPEAKING_VIDEO_SAVE_NODE, LISTENING_VIDEO_SAVE_NODE];

// prompt_id → callback 매핑
const pendingPrompts = new Map();

let comfySocket = null;
let isConnected = false;

// ─── WebSocket 연결 ───

function connectWebSocket() {
  if (comfySocket) {
    try { comfySocket.close(); } catch {}
  }

  comfySocket = new WebSocket(COMFYUI_WS);

  comfySocket.on('open', () => {
    isConnected = true;
    console.log('[COMFYUI] WebSocket connected');
  });

  comfySocket.on('message', async (msg) => {
    let json;
    try { json = JSON.parse(msg); } catch { return; }

    const pid = json.prompt_id || json.data?.prompt_id;
    if (!pid || !pendingPrompts.has(pid)) return;

    const entry = pendingPrompts.get(pid);

    if (json.type === 'progress_state') {
      const nodes = json.data?.nodes || {};

      if (entry.onProgress) {
        entry.onProgress(nodes);
      }

      const allVideoFinished = VIDEO_NODE_IDS.every(
        (id) => nodes[id]?.state === 'finished'
      );

      if (allVideoFinished && !entry._done) {
        entry._done = true;
        console.log(`[COMFYUI] All video nodes finished for prompt ${pid}`);

        // 파일 쓰기 완료 대기 후 History API 호출
        setTimeout(() => fetchHistory(pid), 3000);
      }
    }
  });

  comfySocket.on('close', () => {
    isConnected = false;
    console.log('[COMFYUI] WebSocket disconnected, reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  comfySocket.on('error', (err) => {
    console.error('[COMFYUI] WebSocket error:', err.message);
  });
}

// ─── History API → 비디오 URL 추출 ───

async function fetchHistory(promptId) {
  try {
    const { data: history } = await axios.get(`${COMFYUI_HOST}/history/${promptId}`);
    const record = history[promptId] || Object.values(history)[0];

    if (!record?.outputs) {
      console.error(`[COMFYUI] No outputs in history for prompt ${promptId}`);
      return;
    }

    const result = { speaking: null, listening: null };

    const speakingFile = extractVideoFile(record.outputs[SPEAKING_VIDEO_SAVE_NODE]);
    if (speakingFile) {
      result.speaking = buildVideoUrl(speakingFile);
      console.log(`[COMFYUI] Speaking URL: ${result.speaking}`);
    }

    const listeningFile = extractVideoFile(record.outputs[LISTENING_VIDEO_SAVE_NODE]);
    if (listeningFile) {
      result.listening = buildVideoUrl(listeningFile);
      console.log(`[COMFYUI] Listening URL: ${result.listening}`);
    }

    const entry = pendingPrompts.get(promptId);
    if (entry?.onComplete) {
      entry.onComplete(result);
    }
    pendingPrompts.delete(promptId);
  } catch (err) {
    console.error(`[COMFYUI] History fetch failed:`, err.message);
    const entry = pendingPrompts.get(promptId);
    if (entry?.onError) {
      entry.onError(err);
    }
    if (entry) entry._done = false;
  }
}

function extractVideoFile(nodeOutput) {
  const files = nodeOutput?.videos || nodeOutput?.gifs || nodeOutput?.images;
  return files?.[0] || null;
}

function buildVideoUrl(file) {
  const subfolder = (file.subfolder || '').replace(/\\/g, '/');
  return `${VIDEO_HOST}/${subfolder}/${file.filename}`;
}

// ─── 워크플로우 로드 및 수정 ───

function loadWorkflow(gender) {
  const filename = gender === 'male'
    ? '2026-MaleVideoGenerationWorkflow.json'
    : '2026-FemaleVideoGenerationWorkflow.json';

  const workflowPath = path.join(__dirname, '..', 'workflows', filename);
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 워크플로우의 동적 값을 주입한다.
 * @param {Object} workflow - 워크플로우 JSON
 * @param {Object} options
 * @param {string} options.userId - 사용자 ID
 * @param {string} [options.speakingPrompt] - Speaking 포즈 프롬프트
 * @param {string} [options.listeningPrompt] - Listening 포즈 프롬프트
 */
function prepareWorkflow(workflow, { userId, speakingPrompt, listeningPrompt }) {
  for (const key in workflow) {
    const node = workflow[key];

    if (node.class_type === 'LoadImage') {
      node.inputs.image = `${PROJECT}/${INPUT_FILENAME}`;
    }

    if (node.class_type === 'KSampler' && node.inputs?.seed !== undefined) {
      node.inputs.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }
  }

  if (speakingPrompt && workflow[SPEAKING_PROMPT_NODE]?.inputs) {
    workflow[SPEAKING_PROMPT_NODE].inputs.text = speakingPrompt;
  }

  if (listeningPrompt && workflow[LISTENING_PROMPT_NODE]?.inputs) {
    workflow[LISTENING_PROMPT_NODE].inputs.text = listeningPrompt;
  }

  if (userId) {
    if (workflow[SPEAKING_VIDEO_SAVE_NODE]?.inputs?.filename_prefix != null) {
      workflow[SPEAKING_VIDEO_SAVE_NODE].inputs.filename_prefix = `2026_RoF_output/${userId}/speaking`;
    }
    if (workflow[LISTENING_VIDEO_SAVE_NODE]?.inputs?.filename_prefix != null) {
      workflow[LISTENING_VIDEO_SAVE_NODE].inputs.filename_prefix = `2026_RoF_output/${userId}/listening`;
    }
  }

  delete workflow._geminiImagePrompt;
  return workflow;
}

// ─── 이미지 업로드 ───

async function uploadImage(imageBuffer) {
  const res = await axios.post(
    `${UPLOAD_SERVER}?project=${PROJECT}`,
    imageBuffer,
    { headers: { 'Content-Type': 'application/octet-stream' } }
  );
  console.log(`[COMFYUI] Image uploaded, status=${res.status}`);
  return res.data;
}

// ─── 워크플로우 실행 (Prompt API) ───

/**
 * ComfyUI에 워크플로우를 제출하고 결과를 콜백으로 받는다.
 * @param {Object} workflow - 준비된 워크플로우 JSON
 * @param {Object} callbacks
 * @param {Function} callbacks.onProgress - (nodes) => void
 * @param {Function} callbacks.onComplete - ({speaking, listening}) => void
 * @param {Function} callbacks.onError - (err) => void
 * @returns {Promise<string>} promptId
 */
async function submitWorkflow(workflow, { onProgress, onComplete, onError }) {
  const response = await axios.post(`${COMFYUI_HOST}/prompt`, {
    prompt: workflow,
  });

  const promptId = response.data?.prompt_id;
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt_id');
  }

  console.log(`[COMFYUI] Workflow submitted, promptId=${promptId}`);

  pendingPrompts.set(promptId, {
    onProgress,
    onComplete,
    onError,
    _done: false,
  });

  return promptId;
}

// ─── 초기화 ───

function init() {
  if (!process.env.COMFYUI_HOST && !process.env.COMFYUI_WS) {
    console.warn('[COMFYUI] No ComfyUI config found, skipping WebSocket connection');
    return;
  }
  connectWebSocket();
}

module.exports = {
  init,
  loadWorkflow,
  prepareWorkflow,
  uploadImage,
  submitWorkflow,
  isConnected: () => isConnected,
};
