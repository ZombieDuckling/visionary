const EventEmitter = require('node:events');

const bus = new EventEmitter();
const clients = new Set();
let eventId = 0;

/**
 * Handle an incoming SSE connection.
 * Sets proper headers, sends initial flush, configures keepalive,
 * and cleans up on client disconnect.
 */
function handleSSE(req, res) {
  let closed = false;
  let keepAlive;
  const client = { write };

  function cleanup() {
    if (closed) return;
    closed = true;
    clients.delete(client);
    clearInterval(keepAlive);
    req.removeListener('close', cleanup);
    res.removeListener('close', cleanup);
    // Keep the error listener: a late socket error must remain handled.
  }

  function fail() {
    if (closed) return;
    cleanup();
    if (!res.destroyed) {
      try { res.destroy(); } catch { /* Already released; isolate this peer. */ }
    }
  }

  function write(message) {
    if (closed) return;
    if (res.destroyed || res.writableEnded) { cleanup(); return; }
    try {
      // false means buffered, not failed. Preserve the existing slow-client
      // policy; callbacks and thrown errors are the failure boundary here.
      res.write(message, 'utf8', (err) => { if (err) fail(); });
    } catch { fail(); }
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', fail);
  if (res.destroyed || res.writableEnded) { cleanup(); return; }

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  } catch { fail(); return; }

  write(':ok\n\n');
  write('retry: 3000\n\n');
  if (closed) return;
  clients.add(client);
  keepAlive = setInterval(() => write(': keepalive\n\n'), 30000);
}

/**
 * Broadcast an SSE event to all connected clients.
 * Dead connections are automatically cleaned up on write failure.
 */
function broadcast(eventType, data) {
  eventId++;
  const message = `id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) client.write(message);
}

// Wire bus events to broadcast
bus.on('task:created', (d) => broadcast('task:created', d));
bus.on('task:updated', (d) => broadcast('task:updated', d));
bus.on('task:deleted', (d) => broadcast('task:deleted', d));
bus.on('activity:new', (d) => broadcast('activity:new', d));
bus.on('agent:status', (d) => broadcast('agent:status', d));
bus.on('agent:started', (d) => broadcast('agent:started', d));
bus.on('agent:completed', (d) => broadcast('agent:completed', d));
bus.on('agent:failed', (d) => broadcast('agent:failed', d));
bus.on('agent:progress', (d) => broadcast('agent:progress', d));
bus.on('agent:output', (d) => broadcast('agent:output', d));
bus.on('agent:harness', (d) => broadcast('agent:harness', d));
bus.on('notification:created', (d) => broadcast('notification:created', d));
bus.on('notification:updated', (d) => broadcast('notification:updated', d));
bus.on('interview:updated', (d) => broadcast('interview:updated', d));

module.exports = { bus, handleSSE, broadcast };
