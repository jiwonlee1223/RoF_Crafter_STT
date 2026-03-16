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

  const futureAge = Math.max(age + 10, 20);
  const remainder = futureAge % 10;
  const decade = Math.floor(futureAge / 10) * 10;

  if (remainder <= 2) return `early ${decade}s`;
  if (remainder <= 6) return `mid ${decade}s`;
  return `early ${decade + 10}s`;
}

/**
 * 성별 + 생년월일에 따른 Gemini 이미지 생성 프롬프트 반환
 * @param {string} gender - 성별 ('male' | 'female')
 * @param {string} [birthDateTime] - 생년월일 ("YYYY-MM-DD" 또는 "YYYY-MM-DDThh:mm")
 * @returns {string} Gemini 이미지 생성 프롬프트
 */
function getBaseImagePrompt(gender, birthDateTime) {
  const decade = getFutureAgeDecade(birthDateTime);
  const isMale = gender === "male";
  const person = isMale ? "man" : "woman";
  const pronoun = isMale ? "his" : "her";
  const Person = isMale ? "The man" : "The woman";
  const Pronoun = isMale ? "His" : "Her";

  console.log(`[GEMINI] Prompt age: ${decade}, gender: ${gender}`);

  return `Edit the image: Generate a photorealistic full body portrait of a distinguished ${person} in ${pronoun} ${decade}, wearing a casual outfits. ${Person} leans on a very high and tall stool, body turned to a diagonal angle, head directly facing the camera, with ${pronoun} hands resting gently near ${pronoun} lap or on the chair's armrests. ${Pronoun} legs are fully closed together in a comfortable position. ${Pronoun} posture is composed yet relaxed. The scene is set in a seamless black studio, with the floor and background blending, creating a clean, minimalist environment. A soft shadow beneath the chair anchors ${pronoun} in space and adds subtle depth. The lighting is even and bright, with smooth highlights and cinematic clarity. The image is centered and fully balanced, captured in a distortion-free full-body shot with accurate head-to-body scale and perspective. Ultra-realistic, high-detail, professional studio photography.`;
}

module.exports = {
  generateImageWithGemini,
  getBaseImagePrompt,
};
