import { createServer } from 'node:http';

const port = Number(process.env.MOCK_PORT ?? 4000);
const expectedKey = 'sk-local-demo';

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function chatUsage() {
  return {
    prompt_tokens: 120,
    prompt_cache_hit_tokens: 40,
    prompt_cache_miss_tokens: 80,
    completion_tokens: 80,
    total_tokens: 200,
  };
}

function chatPayload(model) {
  return {
    id: `chatcmpl_mock_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Respons simulasi dari gateway lokal.' }, finish_reason: 'stop' }],
    usage: chatUsage(),
  };
}

function streamChat(response, model) {
  const id = `chatcmpl_mock_${Date.now()}`;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: 'Respons simulasi dari gateway lokal.' }, finish_reason: 'stop' }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [], usage: chatUsage() })}\n\n`);
  response.end('data: [DONE]\n\n');
}

const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${expectedKey}`) {
    sendJson(response, 401, { error: { message: 'Demo upstream expects the registered key sk-local-demo.' } });
    return;
  }

  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && /\/models\/?$/.test(url.pathname)) {
    sendJson(response, 200, { object: 'list', data: [{ id: 'deepseek-chat', object: 'model', owned_by: 'mock' }] });
    return;
  }

  if (request.method === 'POST' && /\/(chat\/completions|completions)\/?$/.test(url.pathname)) {
    const body = await readJson(request);
    const model = typeof body.model === 'string' ? body.model : 'deepseek-chat';
    if (body.stream === true) {
      streamChat(response, model);
      return;
    }
    sendJson(response, 200, chatPayload(model));
    return;
  }

  if (request.method === 'POST' && /\/responses\/?$/.test(url.pathname)) {
    const body = await readJson(request);
    const model = typeof body.model === 'string' ? body.model : 'deepseek-chat';
    sendJson(response, 200, {
      id: `resp_mock_${Date.now()}`,
      object: 'response',
      status: 'completed',
      model,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Respons simulasi dari gateway lokal.' }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200, input_tokens_details: { cached_tokens: 40 } },
    });
    return;
  }

  sendJson(response, 404, { error: { message: `No mock route for ${request.method} ${url.pathname}` } });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock DeepSeek listening on http://127.0.0.1:${port}`);
  console.log(`Demo key: ${expectedKey}`);
});
