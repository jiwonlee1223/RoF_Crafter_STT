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
async function generateResponse(conversationHistory, referenceQuestion, userName) {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }

  const nameContext = userName ? `사용자의 이름은 "${userName}"입니다. 대화 중 자연스럽게 이름을 불러주세요.\n` : '';
  const messages = [
    { role: 'system', content: nameContext + SYSTEM_PROMPT },
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
async function generateGreeting(referenceQuestion, userName) {
  if (!openai) {
    return referenceQuestion || '안녕하세요! 오늘 기분이 어떠세요?';
  }

  const nameContext = userName ? `사용자의 이름은 "${userName}"입니다. 인사할 때 이름을 불러주세요.\n` : '';
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: nameContext + SYSTEM_PROMPT },
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

const PERSONA_SYSTEM_PROMPT = `당신은 사용자의 10년 후 미래 모습을 묘사하는 어시스턴트입니다.
아래 조건을 활용하여 10년후 모습을 묘사하세요.
{
조건 1: 인류통계학 측면에서 이 사용자와 유사한 배경을 가진 사람의 삶의 궤적을 반영하여 예측할 것.
조건 2: 사용자의 미래 변화에 대한 답을 고려하여 예측할 것.
조건 3: 사용자 부모가 어떻게 살길 바랬는지 답을 고려하여 사용자의 미래 삶을 예측할 것.
조건 4: 이 사용자의 태어난 일시에 따른 사주의 대운과 소운이 어떻게 흐르는지 감안하여 예측할 것.
조건 5: 예상치 못한 삶의 궤적이 생긴다는 전제로 예측할 것. 사용자의 성향이 계획적이면 이 조건을 반영할 것.
사용자의 답에서 성향이 계획적이면 조건 1을 45% 반영, 조건 2를 35% 반영, 조건 3을 5%반영, 조건 4를 10% 반영, 조건 5를 5% 반영할 것.
사용자의 답에서 성향이 즉흥적이면 조건 1을 45% 반영, 조건 2를 25% 반영, 조건 3을 5%반영, 조건 4를 10% 반영, 조건 5를 15% 반영할 것.
사용자의 답에서 성향이 중간(계획적, 즉흥적의 사이)이면 조건 1을 45% 반영, 조건 2를 30% 반영, 조건 3을 5%반영, 조건 4를 10% 반영, 조건 5를 10% 반영 할 것.
사용자 퍼소나를 제시할 때 사용자의 프로필, 과거 현재, 미래 계획에 대한 답을 기초로 개인 맞춤형으로 예측할 것.
}`;

/**
 * 대화 이력을 기반으로 10년 후 전시용 페르소나를 생성한다.
 * @param {Array} conversationHistory - [{role: 'agent'|'user', text: string}]
 * @returns {Promise<{personaText: string, cardText: string}>}
 */
async function generateExhibPersona(conversationHistory, birthDateTime) {
  if (!openai) throw new Error('OpenAI client not initialized');

  const userContext = conversationHistory
    .map(t => `${t.role === 'agent' ? '질문' : '답변'}: ${t.text}`)
    .join('\n');

  const birthInfo = birthDateTime
    ? `\n[사용자 생년월일시]\n${birthDateTime}\n`
    : '';

  const userPrompt = `다음의 출력 항목 형식에 따라 사용자의 미래시점의 페르소나를 묘사하세요.
{
    직업, 사회적 위치 (Profession, Social Status)
    가족 구성 (결혼 유무, 자녀 유무 등 포함) (Family Status)
    삶의 만족도, 감정 상태 (Emotional Status)
    성격 (Personality)
    가치관 (무엇에 가치를 두는가) (Value)
    꿈, 바램(Desire)
    삶의 주요 원동력(Motivation)
    우려(Concerns)
    주중에 가장 즐겨 입는 패션 스타일 (Fashion Style)
}
${birthInfo}
[참고 데이터]
${userContext}

[출력 지침]
- 각 항목을 명확히 구분하여 작성
- 각 항목은 2-4문장으로 구체적으로 기술
- 서술형이 아닌 사실적 기술 방식 사용
- 10년 후의 구체적인 나이와 상황 반영`;

  const personaResponse = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: PERSONA_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 2000,
    temperature: 0.85,
  });

  const personaText = personaResponse.choices[0]?.message?.content?.trim() || '';
  console.log(`[AGENT] ExhibPersona generated (${personaText.length} chars)`);

  const cardResponse = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: '다음 페르소나 텍스트를 정확히 3문장으로 축약하세요. 핵심 키워드와 미래 방향성을 담아 간결하게 작성하세요.' },
      { role: 'user', content: personaText },
    ],
    max_completion_tokens: 1000,
    temperature: 0.7,
  });

  const cardText = cardResponse.choices[0]?.message?.content?.trim() || '';
  console.log(`[AGENT] ExhibPersona card generated (${cardText.length} chars)`);

  return { personaText, cardText };
}

module.exports = { init, generateResponse, generateGreeting, generateExhibPersona, SYSTEM_PROMPT };
