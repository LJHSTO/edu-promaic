const endpoint = 'https://api.deepseek.com/chat/completions';
const maxResponseBytes = 32 * 1024;
const instructions = '从给定的已发布微积分教学片段中选一条最适合本级提示的材料。只输出 JSON 对象，例如 {"passageId":"候选条目标识"}。';

async function readResult(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('模型暂时不可用。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxResponseBytes) throw new Error('模型响应过长。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requestBody(model, level, passages) {
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: JSON.stringify({ level, passages }) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 120,
    thinking: { type: 'disabled' },
    stream: false
  });
}

export function createModelPlanner({ apiKey, model, fetcher = fetch, timeout = 2200 } = {}) {
  if (!apiKey && !model) return undefined;
  if (!apiKey || !/^[\w.-]{1,60}$/.test(model ?? '')) throw new Error('请同时配置 DEEPSEEK_API_KEY 与 DEEPSEEK_MODEL。');
  return async ({ level, passages }) => {
    const response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: requestBody(model, level, passages.map(({ id, text }) => ({ id, text })))
    });
    const result = await readResult(response);
    const choice = result?.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
      throw new Error('模型未返回完整选择。');
    }
    const plan = JSON.parse(choice.message.content);
    if (typeof plan?.passageId !== 'string' || Object.keys(plan).length !== 1) {
      throw new Error('模型选择格式无效。');
    }
    return plan.passageId;
  };
}
