const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-pro-image-preview";

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in .env");
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/**
 * 프로필 사진 + 프롬프트를 기반으로 Gemini로 이미지 생성 (image-to-image)
 * @param {Object} params
 * @param {Buffer} params.imageBuffer - 프로필 사진 버퍼
 * @param {string} params.prompt - 이미지 생성 프롬프트
 * @returns {Promise<Buffer>} 생성된 이미지 버퍼
 */
async function generateImageWithGemini({ imageBuffer, prompt }) {
  const genAI = getClient();

  const base64Image = Buffer.isBuffer(imageBuffer)
    ? imageBuffer.toString("base64")
    : Buffer.from(imageBuffer).toString("base64");

  console.log(`[GEMINI] Generating image with model: ${GEMINI_MODEL}`);
  console.log(`[GEMINI] Prompt length: ${prompt.length} chars`);

  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);

  if (!imagePart) {
    throw new Error("Gemini did not return an image in the response");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  console.log(`[GEMINI] Image generated successfully (${mimeType})`);

  return Buffer.from(imagePart.inlineData.data, "base64");
}

/**
 * 생년월일에서 10년 후 연령대 문자열을 계산한다.
 * 0-2: "early 30s", 3-6: "mid 40s", 7-9: "early 50s" (다음 연령대로 올림)
 * e.g. 28세 → 38 → "early 40s", 35세 → 45 → "mid 40s", 21세 → 31 → "early 30s"
 * @param {string} birthDateTime - "YYYY-MM-DD" 또는 "YYYY-MM-DDThh:mm"
 * @returns {string} "early 30s", "mid 40s" 등
 */
function getFutureAgeDecade(birthDateTime) {
  if (!birthDateTime) return "mid 50s";
  const birthDate = new Date(birthDateTime);
  if (isNaN(birthDate.getTime())) return "mid 50s";

  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }

  const futureAge = Math.max(age + 15, 20);
  const remainder = futureAge % 10;
  const decade = Math.floor(futureAge / 10) * 10;

  if (remainder <= 2) return `early ${decade}s`;
  if (remainder <= 6) return `mid ${decade}s`;
  return `early ${decade + 10}s`;
}

/**
 * 성별 + 생년월일 + 페르소나 패션 스타일에 따른 Gemini 이미지 생성 프롬프트 반환
 * @param {string} gender - 성별 ('male' | 'female')
 * @param {string} [birthDateTime] - 생년월일 ("YYYY-MM-DD" 또는 "YYYY-MM-DDThh:mm")
 * @param {string} [fashionDescription] - 페르소나 기반 영어 패션/헤어 묘사 (없으면 기본값 사용)
 * @returns {string} Gemini 이미지 생성 프롬프트
 */
function getBaseImagePrompt(gender, birthDateTime, fashionDescription) {
  const decade = getFutureAgeDecade(birthDateTime);
  const isMale = gender === "male";
  const person = isMale ? "man" : "woman";
  const pronoun = isMale ? "his" : "her";
  const Person = isMale ? "The man" : "The woman";
  const Pronoun = isMale ? "His" : "Her";

  const outfit = fashionDescription || "wearing a casual outfits";
  console.log(`[GEMINI] Prompt age: ${decade}, gender: ${gender}, outfit: "${outfit}"`);

  return `Edit the image: Preserve the person's facial features, face shape, and overall appearance from the reference photo. Generate a photorealistic full body portrait of a distinguished ${person} in ${pronoun} ${decade}, ${outfit}. ${Person} leans on a very high and tall stool, body turned to a diagonal angle, head directly facing the camera, with ${pronoun} hands resting gently near ${pronoun} lap or on the chair's armrests. ${Pronoun} legs are fully closed together in a comfortable position. ${Pronoun} feet and shoes must be fully visible at the bottom of the frame. ${Pronoun} posture is composed yet relaxed. The scene is set in a seamless black studio, with the floor and background blending, creating a clean, minimalist environment. A soft shadow beneath the chair and under ${pronoun} feet anchors ${pronoun} in space and adds subtle depth. The lighting is even and bright, with smooth highlights and cinematic clarity. The image is framed with generous space below the feet, ensuring the entire body from head to toe including shoes and feet is fully visible without any cropping. The composition is centered and fully balanced, captured in a wide-angle distortion-free full-body shot with accurate head-to-body scale and perspective. Ultra-realistic, high-detail, professional studio photography.`;
}

/**
 * 대화 기록 기반 미래 장면 3장 + 초상화 6:9 변환 1장 = 총 4장 생성
 * @param {Object} params
 * @param {Array} params.conversationHistory - [{role: 'agent'|'user', text: string}]
 * @param {string} params.userName - 사용자 이름
 * @param {string} params.birthDateTime - 생년월일 "YYYY-MM-DD"
 * @param {string} params.gender - 'male' | 'female'
 * @param {Buffer} params.rawImageBuffer - 사용자 원본 사진 (미래 장면 3장에 사용)
 * @param {Buffer} params.portraitImageBuffer - Gemini 생성 초상화 이미지 버퍼 (bust shot 변환에 사용)
 * @returns {Promise<Array<{year: number, description: string, imageBuffer: Buffer, mimeType: string}>>}
 */
async function generateFutureScenes({ conversationHistory, userName, birthDateTime, gender, rawImageBuffer, portraitImageBuffer }) {
  const genAI = getClient();

  const userContext = conversationHistory
    .map(t => `${t.role === 'agent' ? '질문' : '답변'}: ${t.text}`)
    .join('\n');

  const currentYear = new Date().getFullYear();
  const isMale = gender === 'male';

  // 1단계: 대화 분석 → 3개 미래 마일스톤 (년도 + 장면 설명)
  const analysisPrompt = `You are a future life analyst. Based on the following conversation with ${userName || 'the user'} (${isMale ? 'male' : 'female'}, born ${birthDateTime || 'unknown'}), predict 3 key milestone moments in their future within the next 10 years (${currentYear + 1} ~ ${currentYear + 10}).

Each milestone should be a vivid, specific life scene — a career achievement, a personal turning point, a meaningful moment, or a lifestyle change — inferred from the conversation content.

Output ONLY a valid JSON array with exactly 3 objects. No markdown, no explanation:
[
  {"year": ${currentYear + 2}, "description_ko": "Korean description for the user", "description_en": "Detailed English scene description for image generation, describing the person, setting, action, mood, lighting. Must be a single scene suitable for photorealistic image generation in 9:6 landscape aspect ratio."},
  ...
]

Pick 3 different years spread across the 10-year range. Make each scene distinct and emotionally resonant.

[Conversation]
${userContext}`;

  console.log(`[GEMINI-FUTURE] Analyzing conversation for future scenes...`);

  const analysisResponse = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
    config: { responseModalities: ["TEXT"] },
  });

  const rawText = analysisResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log(`[GEMINI-FUTURE] Analysis response: ${rawText.substring(0, 200)}...`);

  const jsonStr = rawText.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const milestones = JSON.parse(jsonStr);

  if (!Array.isArray(milestones) || milestones.length !== 3) {
    throw new Error(`Expected 3 milestones, got ${milestones?.length}`);
  }

  console.log(`[GEMINI-FUTURE] Generated ${milestones.length} milestones: ${milestones.map(m => m.year).join(', ')}`);

  // 2단계: 미래 장면 3장 + 초상화 6:9 변환 1장 = 4개 병렬 생성
  const ASPECT_RATIO_INSTRUCTION = 'The image MUST be in 9:6 landscape aspect ratio (width:height = 9:6). Horizontal composition.';

  const base64Raw = rawImageBuffer.toString("base64");
  const base64Portrait = portraitImageBuffer.toString("base64");

  // 미래 장면 3장 (사용자 원본 사진을 참조하여 같은 인물로 생성)
  const scenePromises = milestones.map(async (milestone, idx) => {
    const imagePrompt = `Edit this image: Preserve the person's facial features, face shape, and overall appearance from the reference photo. Place this same person in a new scene: Year ${milestone.year}. ${milestone.description_en}. The person should be the dominant subject, filling a large portion of the frame (at least 60% of the image). Photorealistic, cinematic lighting, high detail, professional photography quality. Do NOT include any text or numbers in the image. ${ASPECT_RATIO_INSTRUCTION}`;

    console.log(`[GEMINI-FUTURE] Generating scene ${idx + 1}/3 for year ${milestone.year}...`);

    const imageResponse = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{
        role: "user",
        parts: [
          { text: imagePrompt },
          { inlineData: { mimeType: "image/jpeg", data: base64Raw } },
        ],
      }],
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });

    const parts = imageResponse.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);

    if (!imagePart) {
      throw new Error(`Gemini did not return an image for year ${milestone.year}`);
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    console.log(`[GEMINI-FUTURE] Scene ${idx + 1}/3 generated (${mimeType}) for year ${milestone.year}`);

    return {
      year: milestone.year,
      description: milestone.description_ko,
      imageBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType,
    };
  });

  // 초상화 → 가로 9:6 바스트 컷 변환 1장
  const portraitPromise = (async () => {
    const portraitYear = currentYear + 10;

    console.log(`[GEMINI-FUTURE] Converting portrait to 9:6 bust shot for year ${portraitYear}...`);

    const portraitResponse = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{
        role: "user",
        parts: [
          { text: `Edit this image: Convert to a bust shot (head and upper body, cut at chest level). Preserve the person's facial features, face shape, and appearance exactly. The person should fill a large portion of the frame — tight bust-level crop with the subject as the dominant element. Reframe to 9:6 landscape aspect ratio (width:height = 9:6). Maintain the same photorealistic quality, lighting, and style. Extend or adjust the background seamlessly. ${ASPECT_RATIO_INSTRUCTION}` },
          { inlineData: { mimeType: "image/jpeg", data: base64Portrait } },
        ],
      }],
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });

    const parts = portraitResponse.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);

    if (!imagePart) {
      throw new Error('Gemini did not return a bust shot image');
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    console.log(`[GEMINI-FUTURE] Portrait bust shot 9:6 done (${mimeType})`);

    return {
      year: portraitYear,
      description: `${portraitYear}년의 나`,
      imageBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType,
    };
  })();

  const [portrait, ...scenes] = await Promise.all([portraitPromise, ...scenePromises]);

  // 초상화(10년 후)를 첫 번째로, 나머지 장면을 년도순으로 정렬
  const sortedScenes = scenes.sort((a, b) => a.year - b.year);
  const results = [portrait, ...sortedScenes];

  console.log(`[GEMINI-FUTURE] All 4 images generated: ${results.map(r => r.year).join(', ')}`);
  return results;
}

module.exports = {
  generateImageWithGemini,
  getBaseImagePrompt,
  generateFutureScenes,
};
