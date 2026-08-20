/**
 * Local mock of the Hermes Dashboard REST API and /api/ws TUI gateway
 * (spec §18.2). Lets the full Electron app run end-to-end with no VPS:
 *
 *   node tests/mock/hermes-mock-server.mjs        # listens on 127.0.0.1:9119
 *
 * Then point the app at host 127.0.0.1 with an SSH config alias that forwards
 * locally, or run integration tests directly against the port.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 9119);

const profiles = [
  { name: 'chief', description: 'Chief of Staff', provider: 'grok', model: 'grok-4.5' },
  { name: 'researcher', description: 'Deep research persona', provider: 'grok', model: 'grok-4.5' },
  { name: 'ops', description: 'Operations', provider: 'grok', model: 'grok-4.5' },
];

const souls = new Map(profiles.map((p) => [p.name, `# Role\n${p.description}\n`]));

const sessions = [
  {
    id: 'r-1',
    profile: 'researcher',
    title: 'Memory systems survey',
    preview: 'Comparing approaches…',
    updated_at: new Date(Date.now() - 3600e3).toISOString(),
  },
  {
    id: 'c-1',
    profile: 'chief',
    title: 'Monday planning',
    preview: 'Top three priorities…',
    updated_at: new Date(Date.now() - 7200e3).toISOString(),
  },
];

const messages = new Map([
  [
    'r-1',
    [
      { id: 1, role: 'user', content: 'Compare memory approaches.', request_id: 'seed-1' },
      { id: 2, role: 'assistant', content: 'Here is a practical comparison…' },
    ],
  ],
  ['c-1', [{ id: 3, role: 'user', content: 'Plan my Monday.', request_id: 'seed-2' }]],
]);

const telegram = new Map(); // profile -> {enabled, hasToken, mentionOnly}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const profile = url.searchParams.get('profile');
  let body = null;
  if (req.method !== 'GET') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
  }
  console.log(`${req.method} ${path}${profile ? `?profile=${profile}` : ''}`);

  if (path === '/api/status') return json(res, 200, { ok: true, version: '0.20.4' });
  if (path === '/api/profiles' && req.method === 'GET') return json(res, 200, { profiles });
  if (path === '/api/profiles' && req.method === 'POST') {
    if (!body?.name) return json(res, 400, { error: 'name required' });
    if (profiles.some((p) => p.name === body.name)) return json(res, 409, { error: 'exists' });
    profiles.push({ name: body.name, description: body.description ?? '', provider: body.provider ?? 'grok', model: body.model ?? 'grok-4.5' });
    souls.set(body.name, '');
    return json(res, 200, { ok: true, name: body.name, path: `/root/.hermes/profiles/${body.name}` });
  }
  const soulMatch = path.match(/^\/api\/profiles\/([^/]+)\/soul$/);
  if (soulMatch) {
    const name = decodeURIComponent(soulMatch[1]);
    if (req.method === 'GET') return json(res, 200, { content: souls.get(name) ?? '' });
    souls.set(name, body?.content ?? '');
    return json(res, 200, { ok: true });
  }
  const descMatch = path.match(/^\/api\/profiles\/([^/]+)\/description$/);
  if (descMatch) return json(res, 200, { ok: true });
  const modelMatch = path.match(/^\/api\/profiles\/([^/]+)\/model$/);
  if (modelMatch) return json(res, 200, { ok: true });
  const profMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
  if (profMatch && req.method === 'DELETE') {
    const name = decodeURIComponent(profMatch[1]);
    const idx = profiles.findIndex((p) => p.name === name);
    if (idx >= 0) profiles.splice(idx, 1);
    return json(res, 200, { ok: true });
  }
  if (profMatch && req.method === 'PATCH') return json(res, 200, { ok: true });

  if (path === '/api/sessions' && req.method === 'GET') {
    return json(res, 200, { sessions: profile ? sessions.filter((s) => s.profile === profile) : sessions });
  }
  if (path === '/api/profiles/sessions/sidebar') {
    return json(res, 200, { sessions: profile ? sessions.filter((s) => s.profile === profile) : sessions });
  }
  if (path === '/api/sessions/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return json(res, 200, { sessions: sessions.filter((s) => s.title.toLowerCase().includes(q)) });
  }
  const msgMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (msgMatch) return json(res, 200, { messages: messages.get(decodeURIComponent(msgMatch[1])) ?? [] });
  const sessMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(sessMatch[1]);
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) sessions.splice(idx, 1);
    return json(res, 200, { ok: true });
  }
  if (sessMatch && req.method === 'PATCH') {
    const id = decodeURIComponent(sessMatch[1]);
    const s = sessions.find((x) => x.id === id);
    if (s && body?.title) s.title = body.title;
    if (s && body?.archived !== undefined) s.archived = body.archived;
    return json(res, 200, { ok: true });
  }
  if (sessMatch && req.method === 'GET') {
    return json(res, 200, sessions.find((s) => s.id === decodeURIComponent(sessMatch[1])) ?? {});
  }

  if (path === '/api/model/info') return json(res, 200, { provider: 'grok', model: 'grok-4.5' });
  if (path === '/api/model/options') {
    return json(res, 200, { options: [{ provider: 'grok', model: 'grok-4.5' }, { provider: 'grok', model: 'grok-4-mini' }] });
  }
  if (path === '/api/tools/toolsets') {
    return json(res, 200, { toolsets: [{ id: 'web', name: 'Web research', enabled: true }, { id: 'terminal', name: 'Terminal', enabled: false }] });
  }
  if (path === '/api/skills') return json(res, 200, { skills: [{ id: 'memo', name: 'Memo writer', enabled: true }] });
  if (path === '/api/mcp') return json(res, 200, { servers: [] });
  if (path === '/api/logs') {
    return json(res, 200, { logs: [{ timestamp: new Date().toISOString(), level: 'info', source: 'gateway', message: 'mock log line' }] });
  }
  if (path === '/api/analytics/usage') return json(res, 200, { total_tokens: 123456 });

  if (path === '/api/messaging/platforms' && req.method === 'GET') {
    const t = telegram.get(profile ?? 'default') ?? { enabled: false, hasToken: false };
    return json(res, 200, { platforms: [{ id: 'telegram', enabled: t.enabled, configured: t.hasToken, running: t.enabled, env: { TELEGRAM_MENTION_ONLY: t.mentionOnly ? 'true' : 'false' } }] });
  }
  const platMatch = path.match(/^\/api\/messaging\/platforms\/([^/]+)$/);
  if (platMatch && req.method === 'PUT') {
    const t = telegram.get(profile ?? 'default') ?? { enabled: false, hasToken: false, mentionOnly: false };
    if (body?.env?.TELEGRAM_BOT_TOKEN) t.hasToken = true;
    if (body?.clear_env?.includes('TELEGRAM_BOT_TOKEN')) t.hasToken = false;
    if (body?.env?.TELEGRAM_MENTION_ONLY) t.mentionOnly = body.env.TELEGRAM_MENTION_ONLY === 'true';
    if (body?.enabled !== undefined) t.enabled = body.enabled;
    telegram.set(profile ?? 'default', t);
    return json(res, 200, { ok: true });
  }
  if (path.match(/^\/api\/messaging\/platforms\/[^/]+\/test$/)) {
    const t = telegram.get(profile ?? 'default');
    return json(res, 200, t?.hasToken ? { ok: true, message: 'getMe ok (mock)' } : { ok: false, message: 'no token configured' });
  }
  if (path.match(/^\/api\/gateway\/(start|stop|restart)$/)) return json(res, 200, { ok: true });

  json(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ server, path: '/api/ws' });

wss.on('connection', (ws) => {
  console.log('ws client connected');
  ws.send(JSON.stringify({ event: 'gateway.ready', params: {} }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const { id, method, params } = msg;
    const reply = (result) => ws.send(JSON.stringify({ id, result }));
    const notFound = () => ws.send(JSON.stringify({ id, error: { code: -32601, message: `method not found: ${method}` } }));
    console.log(`rpc ${method}`);

    switch (method) {
      case 'session.create': {
        const sid = `s-${randomUUID().slice(0, 8)}`;
        sessions.unshift({ id: sid, profile: params?.profile ?? 'chief', title: 'New thread', preview: '', updated_at: new Date().toISOString() });
        messages.set(sid, []);
        reply({ session_id: sid });
        break;
      }
      case 'session.activate':
      case 'session.interrupt':
      case 'session.close':
        reply({ ok: true });
        break;
      case 'prompt.submit':
      case 'session.steer':
      case 'prompt.background': {
        const sid = params?.session_id;
        const requestId = params?.request_id;
        const text = params?.text ?? '';
        messages.get(sid)?.push({ id: Date.now(), role: 'user', content: text, request_id: requestId });
        reply({ ok: true });
        // Stream a canned response with a tool call in the middle.
        const messageId = `m-${randomUUID().slice(0, 8)}`;
        const chunks = ['Working on it. ', 'Here is what the mock server ', 'streams back for: ', `"${text.slice(0, 60)}"`];
        let i = 0;
        setTimeout(() => {
          ws.send(JSON.stringify({ event: 'tool.start', params: { session_id: sid, call_id: 'tc1', tool: 'web.search', input: { query: text.slice(0, 40) } } }));
          setTimeout(() => {
            ws.send(JSON.stringify({ event: 'tool.complete', params: { session_id: sid, call_id: 'tc1', tool: 'web.search', elapsed_ms: 431, output: '3 results (mock)' } }));
            const timer = setInterval(() => {
              if (i < chunks.length) {
                ws.send(JSON.stringify({ event: 'message.delta', params: { session_id: sid, message_id: messageId, delta: chunks[i] } }));
                i++;
              } else {
                clearInterval(timer);
                const full = chunks.join('');
                messages.get(sid)?.push({ id: Date.now(), role: 'assistant', content: full });
                ws.send(JSON.stringify({ event: 'message.complete', params: { session_id: sid, message_id: messageId, text: full } }));
                // Occasionally request an approval to exercise the panel.
                if (/approve|delete|write|deploy/i.test(text)) {
                  ws.send(JSON.stringify({ event: 'approval.request', params: { session_id: sid, request_id: `ap-${randomUUID().slice(0, 6)}`, summary: 'Write file output.md (mock)', detail: 'tool: fs.write\npath: output.md', risk: 'Mutating tool' } }));
                }
              }
            }, 180);
          }, 500);
        }, 250);
        break;
      }
      case 'approval.respond':
      case 'clarify.respond':
      case 'sudo.respond':
      case 'secret.respond':
        reply({ ok: true });
        break;
      case 'session.history':
        reply({ messages: messages.get(params?.session_id) ?? [] });
        break;
      case 'session.branch':
        notFound(); // exercise capability degradation
        break;
      default:
        notFound();
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hermes mock listening on http://127.0.0.1:${PORT} (REST + /api/ws)`);
});
