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
 * 성별에 따른 Gemini 이미지 생성 베이스 프롬프트 반환
 * rewritePromptWithStyle에서 페르소나 기반 복장/헤어로 재작성됨
 * @param {string} gender - 성별 ('male' | 'female')
 * @returns {string} Gemini 이미지 생성 베이스 프롬프트
 */
function getBaseImagePrompt(gender) {
  if (gender === "male") {
    return "Edit the image: Generate a photorealistic full body portrait of a distinguished man in his 50s, wearing a casual outfits. The man leans on a very high and tall stool, body turned to a diagonal angle, head directly facing the camera, with his hands resting gently near his lap or on the chair's armrests. His legs are fully closed together in a comfortable position. His posture is composed yet relaxed. The scene is set in a seamless black studio, with the floor and background blending, creating a clean, minimalist environment. A soft shadow beneath the chair anchors his in space and adds subtle depth. The lighting is even and bright, with smooth highlights and cinematic clarity. The image is centered and fully balanced, captured in a distortion-free full-body shot with accurate head-to-body scale and perspective. Ultra-realistic, high-detail, professional studio photography.";
  }

  return "Edit the image: Generate a photorealistic full body portrait of a distinguished woman in her 50s, wearing a casual outfits. The woman leans on a very high and tall stool, body turned to a diagonal angle, head directly facing the camera, with her hands resting gently near her lap or on the chair's armrests. Her legs are fully closed together in a comfortable position. Her posture is composed yet relaxed. The scene is set in a seamless black studio, with the floor and background blending, creating a clean, minimalist environment. A soft shadow beneath the chair anchors her in space and adds subtle depth. The lighting is even and bright, with smooth highlights and cinematic clarity. The image is centered and fully balanced, captured in a distortion-free full-body shot with accurate head-to-body scale and perspective. Ultra-realistic, high-detail, professional studio photography.";
}

module.exports = {
  generateImageWithGemini,
  getBaseImagePrompt,
};
