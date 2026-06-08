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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Flush the connection with an initial comment
  res.write(':ok\n\n');

  // Tell client to reconnect after 3s if disconnected
  res.write('retry: 3000\n\n');

  clients.add(res);

  // Keepalive every 30 seconds to prevent connection timeout
  const keepAlive = setInterval(() => {
    if (res.destroyed) {
      clearInterval(keepAlive);
      clients.delete(res);
      return;
    }
    try { res.write(': keepalive\n\n'); } catch { clients.delete(res); }
  }, 30000);

  req.on('close', () => {
    clients.delete(res);
    clearInterval(keepAlive);
  });
  res.on('error', () => {
    clients.delete(res);
    clearInterval(keepAlive);
  });
}

/**
 * Broadcast an SSE event to all connected clients.
 * Dead connections are automatically cleaned up on write failure.
 */
function broadcast(eventType, data) {
  eventId++;
  const message = `id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  const dead = [];
  for (const client of clients) {
    if (client.destroyed) { dead.push(client); continue; }
    const canWrite = client.write(message, 'utf8', () => {});
    if (canWrite === false) {
      // Client buffer is full (backpressure) — skip but don't disconnect
      continue;
    }
  }
  for (const dc of dead) clients.delete(dc);
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
bus.on('notification:created', (d) => broadcast('notification:created', d));
bus.on('notification:updated', (d) => broadcast('notification:updated', d));
bus.on('interview:updated', (d) => broadcast('interview:updated', d));

module.exports = { bus, handleSSE, broadcast };
