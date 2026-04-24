const admin = require('firebase-admin');
const path = require('path');
const bcrypt = require('bcrypt');

let db = null;
let bucket = null;
let initialized = false;

function init() {
  if (initialized) return;

  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('[FIREBASE] Config missing - Firebase features disabled');
    return;
  }

  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
    } else {
      console.warn('[FIREBASE] No service account provided - Firebase features disabled');
      return;
    }
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

// ── 전시용 페르소나 저장 → responses/{userId}/exhibPersona/data + card + vars ──
async function saveExhibPersona(userId, personaText, cardText, personaVars) {
  if (!isReady()) return null;
  try {
    const root = db.collection('responses').doc(userId);
    const now = new Date().toISOString();

    const saves = [
      root.collection('exhibPersona').doc('data').set({
        text: personaText,
        createdAt: now,
        personaType: 'exhib',
      }),
      root.collection('exhibPersona').doc('card').set({
        text: cardText,
        createdAt: now,
        personaType: 'exhib',
      }),
    ];

    // 구조화된 페르소나 변수 저장
    if (personaVars && Object.keys(personaVars).length > 0) {
      saves.push(
        root.collection('exhibPersona').doc('vars').set({
          ...personaVars,
          createdAt: now,
          personaType: 'exhib',
        })
      );
    }

    await Promise.all(saves);

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

function buildWavBuffer(pcmBuffer) {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(44 + dataSize - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// ── 음성 파일 저장 → Storage voice/{userId}.wav + Firestore voice/{userId} ──
async function saveVoice(userId, audioBuffer, originalFileName, originalMimeType) {
  if (!isReady() || !bucket) return null;
  try {
    const wavBuffer = buildWavBuffer(audioBuffer);
    const storagePath = `voice/${userId}.wav`;
    const file = bucket.file(storagePath);

    await file.save(wavBuffer, {
      metadata: { contentType: 'audio/wav' },
    });

    const [storageUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2030-01-01',
    });

    const now = admin.firestore.Timestamp.now();
    const durationSec = audioBuffer.length / (16000 * 2);

    await db.collection('voice').doc(userId).set({
      storageUrl,
      storagePath,
      audioType: 'audio/wav',
      durationSec: Math.round(durationSec * 10) / 10,
      fileSizeBytes: wavBuffer.length,
      converted: false,
      createdAt: now,
      timestamp: now,
      userId,
    });

    console.log(`[FIREBASE] Voice saved: ${storagePath} (${durationSec.toFixed(1)}s, ${(wavBuffer.length / 1024).toFixed(1)}KB)`);
    return storagePath;
  } catch (err) {
    console.error('[FIREBASE] Voice save failed:', err.message);
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

async function getVoice(userId) {
  if (!isReady()) return null;
  try {
    const doc = await db.collection('voice').doc(userId).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (err) {
    console.error('[FIREBASE] getVoice failed:', err.message);
    return null;
  }
}

// ── 미래 장면 이미지 저장 → Storage photo_test/{userId}/ + Firestore photo_test/{userId} ──
async function saveFutureImages(userId, futureImages) {
  if (!isReady() || !bucket) {
    console.error('[FIREBASE] saveFutureImages skipped — isReady:', isReady(), 'bucket:', !!bucket);
    return null;
  }
  try {
    console.log(`[FIREBASE] saveFutureImages called — userId=${userId}, images=${futureImages.length}`);
    const now = new Date().toISOString();
    const scenes = [];

    for (let i = 0; i < futureImages.length; i++) {
      const { year, description, imageBuffer, mimeType } = futureImages[i];
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const storagePath = `photo_test/${userId}/${year}_${i}.${ext}`;
      const file = bucket.file(storagePath);

      await file.save(imageBuffer, {
        metadata: { contentType: mimeType },
      });

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '2030-01-01',
      });

      scenes.push({ year, description, imageUrl: url, storagePath });
    }

    await db.collection('photo_test').doc(userId).set({
      userId,
      scenes,
      isPrinted: false,
      createdAt: now,
    });

    console.log(`[FIREBASE] Future scenes saved for user: ${userId} (${scenes.length} images)`);
    return scenes;
  } catch (err) {
    console.error('[FIREBASE] Future scenes save failed:', err.message);
    return null;
  }
}

// ── 사용자 촬영 기초 입력 이미지 저장 → Storage input_images/{userId}.jpg + Firestore inputImages/{userId} ──
async function saveInputImage(userId, imageBuffer, mimeType = 'image/jpeg') {
  if (!isReady() || !bucket) {
    console.warn('[FIREBASE] saveInputImage skipped — not ready');
    return null;
  }
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const storagePath = `input_images/${userId}.${ext}`;
    const file = bucket.file(storagePath);

    await file.save(imageBuffer, {
      metadata: { contentType: mimeType },
    });

    const [storageUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2030-01-01',
    });

    const now = new Date().toISOString();
    await db.collection('inputImages').doc(userId).set({
      userId,
      storagePath,
      storageUrl,
      mimeType,
      fileSizeBytes: imageBuffer.length,
      createdAt: now,
    });

    console.log(`[FIREBASE] Input image saved: ${storagePath} (${(imageBuffer.length / 1024).toFixed(1)}KB)`);
    return { storagePath, storageUrl };
  } catch (err) {
    console.error('[FIREBASE] Input image save failed:', err.message);
    return null;
  }
}

// ── 방문(로그인) 기록 저장 → visitLogs/{auto-id} ──
async function saveVisitLog(userId, name, birth, gender) {
  if (!isReady()) return null;
  try {
    const docRef = db.collection('visitLogs').doc();
    await docRef.set({
      userId,
      name: name || '',
      birth: birth || '',
      gender: gender || '',
      visitedAt: new Date().toISOString(),
    });
    console.log(`[FIREBASE] Visit log saved: ${userId}`);

    if (userId && gender) {
      await db.collection('responses').doc(userId)
        .collection('default').doc('data')
        .set({ gender }, { merge: true });
      console.log(`[FIREBASE] Gender saved: responses/${userId}/default/data`);
    }

    return true;
  } catch (err) {
    console.error('[FIREBASE] Visit log save failed:', err.message);
    return null;
  }
}

// ── 전체 방문 기록 조회 ──
async function getAllVisitLogs() {
  if (!isReady()) return [];
  try {
    const snapshot = await db.collection('visitLogs')
      .orderBy('visitedAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error('[FIREBASE] getAllVisitLogs failed:', err.message);
    return [];
  }
}

// ── 추가 인터뷰 연락처 저장 → contactInfo/{userId} ──
async function saveContactInfo(userId, phone, email) {
  if (!isReady()) {
    console.warn('[FIREBASE] Firestore not connected - contact info not saved');
    return null;
  }
  try {
    const docRef = db.collection('contactInfo').doc(userId);
    await docRef.set({
      userId,
      phone: phone || '',
      email: email || '',
      createdAt: new Date().toISOString(),
    });
    console.log(`[FIREBASE] Contact info saved: contactInfo/${userId}`);
    return true;
  } catch (err) {
    console.error('[FIREBASE] Contact info save failed:', err.message);
    return null;
  }
}

// ── 전체 연락처 목록 조회 ──
async function getAllContactInfo() {
  if (!isReady()) return [];
  try {
    const snapshot = await db.collection('contactInfo')
      .orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error('[FIREBASE] getAllContactInfo failed:', err.message);
    return [];
  }
}

module.exports = {
  init,
  isReady,
  registerUser,
  loginUser,
  saveConversation,
  saveExhibPersona,
  saveVoice,
  getVoice,
  saveChatHistory,
  saveGeneratedVideo,
  uploadAudio,
  saveFutureImages,
  saveInputImage,
  saveContactInfo,
  getAllContactInfo,
  saveVisitLog,
  getAllVisitLogs,
};
