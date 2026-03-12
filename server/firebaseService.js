const admin = require('firebase-admin');
const path = require('path');
const bcrypt = require('bcrypt');

let db = null;
let bucket = null;
let initialized = false;

function init() {
  if (initialized) return;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath || !process.env.FIREBASE_PROJECT_ID) {
    console.warn('[FIREBASE] Config missing - Firebase features disabled');
    return;
  }

  try {
    const serviceAccount = require(path.resolve(serviceAccountPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    db = admin.firestore();
    bucket = admin.storage().bucket();
    initialized = true;
    console.log('[FIREBASE] Initialized');
  } catch (err) {
    console.warn('[FIREBASE] Init failed:', err.message);
  }
}

function isReady() {
  return initialized && db !== null;
}

// ── 회원가입 ──
async function registerUser(userId, password) {
  if (!isReady()) throw new Error('Firebase not initialized');

  const doc = await db.collection('users').doc(userId).get();
  if (doc.exists) throw new Error('이미 존재하는 아이디입니다');

  const hashed = await bcrypt.hash(password, 10);
  await db.collection('users').doc(userId).set({
    password: hashed,
    createdAt: new Date().toISOString(),
  });
  console.log(`[FIREBASE] User registered: ${userId}`);
  return userId;
}

// ── 로그인 ──
async function loginUser(userId, password) {
  if (!isReady()) throw new Error('Firebase not initialized');

  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) throw new Error('존재하지 않는 아이디입니다');

  const isMatch = await bcrypt.compare(password, doc.data().password);
  if (!isMatch) throw new Error('비밀번호가 일치하지 않습니다');

  console.log(`[FIREBASE] User logged in: ${userId}`);
  return userId;
}

// ── 대화 세션 저장 → responses/{userId}/default/data ──
async function saveConversation(userId, sessionData) {
  if (!isReady()) {
    console.warn('[FIREBASE] Firestore not connected - local only');
    return null;
  }
  try {
    const docId = userId || sessionData.session_id;
    const docRef = db.collection('responses').doc(docId)
      .collection('default').doc('data');
    await docRef.set(sessionData, { merge: true });
    console.log(`[FIREBASE] Conversation saved: responses/${docId}/default/data`);
    return docId;
  } catch (err) {
    console.error('[FIREBASE] Save failed:', err.message);
    return null;
  }
}

// ── 전시용 페르소나 저장 → responses/{userId}/exhibPersona/data + card ──
async function saveExhibPersona(userId, personaText, cardText) {
  if (!isReady()) return null;
  try {
    const root = db.collection('responses').doc(userId);
    const now = new Date().toISOString();

    await root.collection('exhibPersona').doc('data').set({
      text: personaText,
      createdAt: now,
      personaType: 'exhib',
    });

    await root.collection('exhibPersona').doc('card').set({
      text: cardText,
      createdAt: now,
      personaType: 'exhib',
    });

    console.log(`[FIREBASE] ExhibPersona saved for user: ${userId}`);
    return true;
  } catch (err) {
    console.error('[FIREBASE] ExhibPersona save failed:', err.message);
    return null;
  }
}

// ── 채팅 히스토리 메타 저장 ──
async function saveChatHistory(sessionId, userId, turnCount) {
  if (!isReady()) return null;
  try {
    const docRef = db.collection('chatHistory').doc(sessionId);
    await docRef.set({
      userId: userId || sessionId,
      sessionId,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      chatCount: turnCount,
      isActive: false,
    });
    console.log(`[FIREBASE] ChatHistory saved: ${sessionId}`);
    return docRef.id;
  } catch (err) {
    console.error('[FIREBASE] ChatHistory save failed:', err.message);
    return null;
  }
}

// ── 비디오 URL 저장 ──
async function saveGeneratedVideo(userId, videoData) {
  if (!isReady()) return null;
  try {
    await db.collection('generatedVideos').doc(userId).set({
      speakingUrl: videoData.speakingUrl || null,
      listeningUrl: videoData.listeningUrl || null,
      userId,
      createdAt: new Date().toISOString(),
    }, { merge: true });
    console.log(`[FIREBASE] Video saved for user: ${userId}`);
    return true;
  } catch (err) {
    console.error('[FIREBASE] Video save failed:', err.message);
    return null;
  }
}

// ── 오디오 업로드 ──
async function uploadAudio(sessionId, audioBuffer, mimeType = 'audio/webm') {
  if (!initialized || !bucket) {
    console.warn('[FIREBASE] Storage not connected - skipping upload');
    return null;
  }
  try {
    const filePath = `sessions/${sessionId}/last_answer.webm`;
    const file = bucket.file(filePath);

    await file.save(audioBuffer, {
      metadata: { contentType: mimeType },
    });

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '2030-01-01',
    });

    console.log(`[FIREBASE] Audio uploaded: ${filePath}`);
    return url;
  } catch (err) {
    console.error('[FIREBASE] Upload failed:', err.message);
    return null;
  }
}

module.exports = {
  init,
  isReady,
  registerUser,
  loginUser,
  saveConversation,
  saveExhibPersona,
  saveChatHistory,
  saveGeneratedVideo,
  uploadAudio,
};
