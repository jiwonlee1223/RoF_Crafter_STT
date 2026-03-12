const admin = require('firebase-admin');
const path = require('path');

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

async function saveConversation(sessionData) {
  if (!initialized || !db) {
    console.warn('[FIREBASE] Firestore not connected - local only');
    return null;
  }
  try {
    const docRef = db.collection('conversations').doc(sessionData.session_id);
    await docRef.set(sessionData);
    console.log(`[FIREBASE] Conversation saved: ${sessionData.session_id}`);
    return docRef.id;
  } catch (err) {
    console.error('[FIREBASE] Save failed:', err.message);
    return null;
  }
}

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

module.exports = { init, saveConversation, uploadAudio };
