const OpenAI = require('openai');

let openai = null;

const SYSTEM_PROMPT = `당신은 따뜻하고 공감 능력이 뛰어난 대화 에이전트입니다.
사용자와 자연스러운 한국어 대화를 나누세요.

규칙:
- 답변은 반드시 1~2문장으로 짧게 하세요. TTS로 읽히기 때문에 길면 안 됩니다.
- 사용자의 답변에 공감하는 리액션을 먼저 한 뒤, 자연스럽게 다음 질문으로 이어가세요.
- 존댓말을 사용하세요.
- 이모지를 사용하지 마세요.
- 시스템이 지시하는 "참고 질문"의 의도를 반영하여 자연스럽게 질문하세요. 질문을 그대로 읽지 말고, 대화 맥락에 맞게 변형하세요.`;

function init() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[AGENT] OpenAI API key not set');
    return;
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('[AGENT] OpenAI client initialized');
}

/**
 * 대화 이력 + 참고 질문을 기반으로 에이전트의 다음 응답을 생성한다.
 * @param {Array} conversationHistory - [{role: 'agent'|'user', text: string}]
 * @param {string} referenceQuestion - questions.json에서 가져온 참고 질문
 * @returns {Promise<string>}
 */
async function generateResponse(conversationHistory, referenceQuestion) {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  for (const turn of conversationHistory) {
    messages.push({
      role: turn.role === 'agent' ? 'assistant' : 'user',
      content: turn.text,
    });
  }

  messages.push({
    role: 'system',
    content: `[참고 질문] 다음 질문의 의도를 반영하여 사용자에게 자연스럽게 질문하세요: "${referenceQuestion}"`,
  });

  const startTime = Date.now();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 150,
    temperature: 0.8,
  });

  const text = response.choices[0]?.message?.content?.trim() || '';
  console.log(`[AGENT] Response (${Date.now() - startTime}ms): "${text}"`);
  return text;
}

/**
 * 첫 인사를 생성한다. 참고 질문의 의도를 반영.
 * @param {string} referenceQuestion - questions.json의 첫 번째 질문
 */
async function generateGreeting(referenceQuestion) {
  if (!openai) {
    return referenceQuestion || '안녕하세요! 오늘 기분이 어떠세요?';
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `[참고 질문] 대화를 시작하세요. 첫 인사와 함께, 다음 질문의 의도를 반영하여 자연스럽게 질문하세요: "${referenceQuestion}"`,
      },
    ],
    max_tokens: 100,
    temperature: 0.9,
  });

  return response.choices[0]?.message?.content?.trim() || referenceQuestion;
}

module.exports = { init, generateResponse, generateGreeting, SYSTEM_PROMPT };
