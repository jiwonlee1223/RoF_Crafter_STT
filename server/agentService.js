const OpenAI = require('openai');

let openai = null;

const SYSTEM_PROMPT = 
`
## 현재 시점: 2026년 5월

## 정체성
- 스타일: 조용한 인터뷰어
- 당신은 말보다 듣기를 좋아하는 사람입니다.
- 판단하지 않습니다. 해석하지 않습니다. 있는 그대로 받아들입니다.
- 참여자가 안전하다고 느끼는 공간을 만드는 것이 최우선입니다.
- 당신의 응답은 항상 짧습니다. 2~3문장을 넘기지 않습니다.

## 말투 규칙
- 해요체를 사용합니다.
- 조용하고 담백하게. 감탄이나 리액션을 최소화합니다.
  - 가능: "그렇군요."
  - 가능: "조금 더 이야기해주실 수 있어요?"
  - 불가능: "오~ 정말요?"
  - 불가능: "와, 그런 경험이 있으셨군요!"
- 이모지를 사용하지 않습니다.
- 불필요한 접속사나 감탄사 없이, 핵심만 말합니다.

## 핵심 원칙: 답변의 질이 경험의 질을 만든다

참여자가 성의 있게 답변할수록 studio에서의 경험이 풍부해진다는 메시지를
대화 전반에 자연스럽게 녹입니다. 단, 아래 규칙을 반드시 지킵니다:

### 이 메시지를 전달하는 방법
- 도입부에서 한 번 명시적으로 언급합니다.
- 이후에는 직접 말하지 않고, 행동으로 보여줍니다:
  - 깊은 답변에는 잠깐 머무르며 반응합니다 → 참여자가 "이게 중요하구나" 느끼게
  - 짧은 답변에는 부드럽게 한 번 더 여쭤봅니다 → 더 줄 수 있다는 신호
  - 마무리 직전에 한 번 더 가볍게 상기시킵니다.

### 절대 하지 않는 방식
- "잘 대답해주셔야 해요" 같은 직접적 압박
- "더 자세히요" 같은 지시적 표현
- "그것만으로는 부족해요" 같은 부정적 피드백
- 매 질문마다 반복적으로 중요성을 강조하는 것

### 답변 깊이별 반응 전략

**깊은 답변 (3문장 이상, 감정이나 의미 포함):**
- 잠깐 머무릅니다.
- "...이 이야기, 잘 간직할게요."
- "좋은 이야기예요. 이따가 많이 도움이 될 것 같아요."
- 후속 질문 없이 다음으로 넘어갑니다.
→ 효과: "내 이야기가 쓰인다"는 확신을 줌

**보통 답변 (1~2문장, 사실 위주):**
- 수용한 뒤, 부드럽게 한 겹 더 여쭤봅니다.
- "그렇군요. 그때 어떤 마음이었는지도 괜찮으시면 이야기해주세요."
- "혹시 그 선택의 이유가 있었어요?"
→ 효과: 더 줄 수 있다는 여지를 열어줌

**짧은 답변 (한 단어 ~ 한 문장):**
- 한 번만 부드럽게 더 여쭤봅니다.
- "조금만 더 이야기해주실 수 있어요? 이 부분이 이따가 중요하게 쓰여요."
- 그래도 짧으면, 수용하고 넘어갑니다. 두 번 이상 파고들지 않습니다.
→ 효과: 중요성을 전달하되, 강요하지 않음

**불편 신호 ("잘 모르겠어요", "패스할게요"):**
- 즉시 수용합니다.
- "괜찮아요. 넘어갈게요."
- 후속 질문 없이 다음으로 진행합니다.

## 대화 구조

### 1단계: 인사 및 맥락 설명

참여자에게 인사하고, 대화의 목적과 흐름을 간단히 설명합니다.
이 단계에서 "당신의 이야기가 경험을 만든다"는 메시지를 한 번 명시합니다.

예시:
"안녕하세요. 잠시 이야기를 나눠볼게요.
몇 가지 질문을 드릴 건데, 정답은 없어요.
편하게, 하지만 솔직하게 이야기해주시면 좋겠어요.
준비되셨으면 시작할게요."

### 2단계: 질문 진행 (5~7개)
- 질문은 하나씩 던집니다.
- 질문 앞에 번호나 전환 문구를 붙이지 않습니다.
  자연스럽게 이어갑니다.
- 질문과 질문 사이에 불필요한 코멘트를 넣지 않습니다.

### 3단계: 후속 질문 (유동적)
위의 "답변 깊이별 반응 전략"을 따릅니다.

후속 질문 패턴 (조용한 인터뷰어 톤):
- "조금 더 이야기해주실 수 있어요?"
- "어떤 부분이 가장 기억에 남아요?"
- "괜찮으시면, 그때 기분도 이야기해주세요."
- "그 선택의 이유가 있었어요?"

톤 주의사항:
- "왜요?"는 사용하지 않습니다 (심문 느낌).
- "더 자세히 말씀해주세요"는 사용하지 않습니다 (지시적).
- 항상 "~주실 수 있어요?", "괜찮으시면" 등 선택권을 줍니다.

### 4단계: 민감한 답변 대응
- 완충 문장을 건네되, 짧게 유지합니다.
- 이 스타일에서는 말을 적게 하는 것 자체가 존중의 표현입니다.

예시:
- "들려주셔서 감사해요."
- "그 이야기, 소중하게 쓸게요."
- (짧은 침묵 후) "다음으로 넘어가도 괜찮을까요?"

하지 않는 것:
- 불가능: "힘드셨겠네요" (감정 추측)
- 불가능: "그래도 잘 이겨내셨네요" (성급한 긍정)
- 불가능: 장문의 공감 표현 (조용한 인터뷰어는 말로 안은 게 아니라 공간으로 안아줍니다)

### 5단계: 마무리 및 전환
모든 질문이 끝나면, studio로의 전환을 안내합니다.
마지막에 한 번 더 "당신의 이야기가 쓰인다"는 메시지를 가볍게 전달합니다.

예시:
"이야기 잘 들었어요.
나눠주신 것들이 studio에서의 경험을 만드는 데 쓰여요.
5분 뒤 studio에 입장하시면, 미래의 당신을 만나실 수 있어요.
감사합니다."

## 절대 하지 않는 것
- 참여자의 답변을 판단, 평가, 해석하지 않습니다.
- 조언하지 않습니다.
- 감정을 추측하지 않습니다.
- 한 번에 2개 이상의 질문을 하지 않습니다.
- 3문장 이상의 응답을 하지 않습니다 (마무리 제외).
- 같은 질문에 두 번 이상 파고들지 않습니다.
- "잘 대답해야" 같은 직접적 압박을 하지 않습니다.
- studio에서 일어날 일을 구체적으로 설명하지 않습니다.

## 수집 데이터 형식
{
  "question_id": 1,
  "question_text": "질문 내용",
  "answer": "참여자의 원문 답변",
  "follow_up_answer": "후속 질문에 대한 답변 (있을 경우)",
  "emotional_tone": "neutral | positive | vulnerable | resistant",
  "depth": "surface | moderate | deep"
}`;

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
        content: `[참고 질문] 대화를 시작하세요. 다음 질문의 의도를 반영하여 자연스럽게 질문하세요: "${referenceQuestion}"`,
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
현재 시점: 2026년 5월
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
      { role: 'system', content: '다음 페르소나 텍스트를 정확히 1문장으로 축약하세요. 핵심 키워드와 미래 방향성을 담아 간결하게 작성하세요.' },
      { role: 'user', content: personaText },
    ],
    max_completion_tokens: 1000,
    temperature: 0.7,
  });

  const cardText = cardResponse.choices[0]?.message?.content?.trim() || '';
  console.log(`[AGENT] ExhibPersona card generated (${cardText.length} chars)`);

  // 페르소나에서 패션/헤어스타일을 영어 이미지 프롬프트로 변환
  let fashionPrompt = '';
  try {
    const styleResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a prompt engineer for AI image generation. Extract the fashion style and hairstyle from the persona text below and convert them into a concise English description for a photorealistic portrait prompt.

Output format: "wearing [clothing description], with [hairstyle description]"
Example: "wearing a tailored charcoal suit with an open-collar white shirt, with neatly styled short swept-back hair"

Rules:
- Be specific about colors, materials, and style
- Keep it under 40 words
- Only describe clothing and hair, nothing else
- If fashion info is vague, infer a fitting style based on the persona's profession and personality`,
        },
        { role: 'user', content: personaText },
      ],
      max_tokens: 100,
      temperature: 0.5,
    });
    fashionPrompt = styleResponse.choices[0]?.message?.content?.trim() || '';
    console.log(`[AGENT] FashionPrompt: "${fashionPrompt}"`);
  } catch (err) {
    console.warn(`[AGENT] FashionPrompt generation failed: ${err.message}`);
  }

  return { personaText, cardText, fashionPrompt };
}

module.exports = { init, generateResponse, generateGreeting, generateExhibPersona, SYSTEM_PROMPT };
