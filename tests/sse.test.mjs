import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bus, handleSSE, broadcast } = require('../sse.js');

function writeCallback(encoding, callback) {
  if (typeof encoding === 'function') return encoding;
  if (typeof callback === 'function') return callback;
  return null;
}

function createPair() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  res.writeHead = () => {};
  res.write = () => true;
  res.end = () => {
    res.writableEnded = true;
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  return { req, res };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('sse client write failures', { concurrency: false }, () => {
  test('public exports stay bus, handleSSE, and broadcast', () => {
    assert.equal(typeof handleSSE, 'function');
    assert.equal(typeof broadcast, 'function');
    assert.equal(typeof bus.on, 'function');
    assert.equal(typeof bus.emit, 'function');
  });

  test('a synchronous write throw still delivers that event to a healthy client', () => {
    const bad = createPair();
    const good = createPair();
    const goodChunks = [];
    let terminations = 0;
    bad.res.destroy = () => {
      terminations += 1;
      bad.res.destroyed = true;
      bad.res.emit('error', new Error('terminated'));
    };
    bad.res.write = (chunk) => {
      if (String(chunk).startsWith('id:')) throw new Error('client write failed');
      return true;
    };
    good.res.write = (chunk) => {
      goodChunks.push(String(chunk));
      return true;
    };

    try {
      handleSSE(bad.req, bad.res);
      handleSSE(good.req, good.res);
      let thrown = null;
      try {
        broadcast('agent:status', { ok: true });
      } catch (err) {
        thrown = err;
      }
      assert.equal(thrown, null);
      const events = goodChunks.filter((chunk) => chunk.startsWith('id:'));
      assert.equal(events.length, 1);
      assert.match(events[0], /^id: \d+\nevent: agent:status\ndata: \{"ok":true\}\n\n$/);
      assert.equal(terminations, 1);
    } finally {
      bad.req.emit('close');
      good.req.emit('close');
    }
  });

  test('an asynchronous write callback error removes only the failed client', async () => {
    const bad = createPair();
    const good = createPair();
    let badEvents = 0;
    let goodEvents = 0;
    let terminations = 0;
    bad.res.destroy = () => {
      terminations += 1;
      bad.res.destroyed = true;
      bad.res.emit('error', new Error('terminated'));
    };
    bad.res.write = (chunk, encoding, callback) => {
      const done = writeCallback(encoding, callback);
      if (String(chunk).startsWith('id:')) {
        badEvents += 1;
        if (done) queueMicrotask(() => done(new Error('async write failed')));
      }
      return true;
    };
    good.res.write = (chunk) => {
      if (String(chunk).startsWith('id:')) goodEvents += 1;
      return true;
    };

    try {
      handleSSE(bad.req, bad.res);
      handleSSE(good.req, good.res);
      broadcast('task:created', { n: 1 });
      await flush();
      broadcast('task:updated', { n: 2 });
      assert.equal(badEvents, 1);
      assert.equal(goodEvents, 2);
      assert.equal(terminations, 1);
    } finally {
      bad.req.emit('close');
      good.req.emit('close');
    }
  });

  test('response close leaves no heartbeat or later event writes', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let keepalives = 0;
    res.write = (chunk) => {
      if (String(chunk).includes('keepalive')) keepalives += 1;
      return true;
    };
    try {
      handleSSE(req, res);
      res.emit('close');
      t.mock.timers.tick(30000);
      let events = 0;
      res.write = (chunk) => {
        if (String(chunk).startsWith('id:')) events += 1;
        return true;
      };
      broadcast('task:created', { n: 1 });
      assert.equal(keepalives, 0);
      assert.equal(events, 0);
    } finally {
      req.emit('close');
    }
  });

  test('response error leaves no heartbeat or later event writes', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let keepalives = 0;
    res.write = (chunk) => {
      if (String(chunk).includes('keepalive')) keepalives += 1;
      return true;
    };
    try {
      handleSSE(req, res);
      res.emit('error', new Error('socket error'));
      t.mock.timers.tick(30000);
      let events = 0;
      res.write = (chunk) => {
        if (String(chunk).startsWith('id:')) events += 1;
        return true;
      };
      broadcast('task:created', { n: 1 });
      assert.equal(keepalives, 0);
      assert.equal(events, 0);
    } finally {
      req.emit('close');
    }
  });

  test('an already destroyed response leaves no heartbeat or later event writes', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let keepalives = 0;
    res.write = (chunk) => {
      if (String(chunk).includes('keepalive')) keepalives += 1;
      return true;
    };
    try {
      handleSSE(req, res);
      res.destroyed = true;
      broadcast('task:created', { n: 1 });
      res.destroyed = false;
      t.mock.timers.tick(30000);
      assert.equal(keepalives, 0);
    } finally {
      req.emit('close');
    }
  });

  test('a synchronous initial write throw never registers the client', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let writes = 0;
    res.write = () => {
      writes += 1;
      throw new Error('initial write failed');
    };
    try {
      assert.doesNotThrow(() => handleSSE(req, res));
      res.write = () => {
        writes += 1;
        return true;
      };
      t.mock.timers.tick(30000);
      broadcast('task:created', { n: 1 });
      assert.equal(writes, 1);
    } finally {
      req.emit('close');
    }
  });

  test('an initial write callback error never leaves the client registered', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    res.write = (chunk, encoding, callback) => {
      const done = writeCallback(encoding, callback);
      if (String(chunk).startsWith(':ok') && done) done(new Error('initial callback failed'));
      return true;
    };
    try {
      handleSSE(req, res);
      await flush();
      let later = 0;
      res.write = () => {
        later += 1;
        return true;
      };
      t.mock.timers.tick(30000);
      broadcast('notification:created', { n: 1 });
      assert.equal(later, 0);
    } finally {
      req.emit('close');
    }
  });

  test('a heartbeat write throw clears the keepalive timer', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let attempts = 0;
    res.write = (chunk) => {
      if (String(chunk).includes('keepalive')) {
        attempts += 1;
        throw new Error('heartbeat failed');
      }
      return true;
    };
    try {
      handleSSE(req, res);
      t.mock.timers.tick(30000);
      t.mock.timers.tick(30000);
      assert.equal(attempts, 1);
    } finally {
      req.emit('close');
    }
  });

  test('a heartbeat write callback error clears the keepalive timer', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let attempts = 0;
    res.write = (chunk, encoding, callback) => {
      if (String(chunk).includes('keepalive')) {
        attempts += 1;
        const done = writeCallback(encoding, callback);
        if (done) queueMicrotask(() => done(new Error('heartbeat callback failed')));
      }
      return true;
    };
    try {
      handleSSE(req, res);
      t.mock.timers.tick(30000);
      await flush();
      t.mock.timers.tick(30000);
      assert.equal(attempts, 1);
    } finally {
      req.emit('close');
    }
  });

  test('happy path keeps headers, framing, and monotonic ids', () => {
    const { req, res } = createPair();
    let status = 0;
    let headers = null;
    const chunks = [];
    res.writeHead = (code, value) => {
      status = code;
      headers = value;
    };
    res.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      handleSSE(req, res);
      broadcast('task:created', { a: 1 });
      broadcast('task:updated', { a: 2 });
      assert.equal(status, 200);
      assert.equal(headers['Content-Type'], 'text/event-stream');
      assert.equal(headers['Cache-Control'], 'no-cache');
      assert.equal(headers.Connection, 'keep-alive');
      assert.equal(headers['X-Accel-Buffering'], 'no');
      assert.equal(chunks[0], ':ok\n\n');
      assert.equal(chunks[1], 'retry: 3000\n\n');
      const first = chunks[2];
      const second = chunks[3];
      const firstId = Number(/^id: (\d+)\n/.exec(first)[1]);
      const secondId = Number(/^id: (\d+)\n/.exec(second)[1]);
      assert.equal(secondId, firstId + 1);
      assert.equal(first, `id: ${firstId}\nevent: task:created\ndata: ${JSON.stringify({ a: 1 })}\n\n`);
      assert.equal(second, `id: ${secondId}\nevent: task:updated\ndata: ${JSON.stringify({ a: 2 })}\n\n`);
    } finally {
      req.emit('close');
    }
  });

  test('backpressure keeps the client registered for subsequent writes', () => {
    const { req, res } = createPair();
    let events = 0;
    res.write = (chunk) => {
      if (String(chunk).startsWith('id:')) {
        events += 1;
        return false;
      }
      return true;
    };
    try {
      handleSSE(req, res);
      broadcast('activity:new', { n: 1 });
      broadcast('activity:new', { n: 2 });
      assert.equal(events, 2);
    } finally {
      req.emit('close');
    }
  });

  test('repeated close and a late error stay idempotent', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    let keepalives = 0;
    res.write = (chunk) => {
      if (String(chunk).includes('keepalive')) keepalives += 1;
      return true;
    };
    try {
      handleSSE(req, res);
      req.emit('close');
      req.emit('close');
      res.emit('close');
      assert.doesNotThrow(() => res.emit('error', new Error('after release')));
      t.mock.timers.tick(60000);
      assert.equal(keepalives, 0);
    } finally {
      req.emit('close');
    }
  });

  for (const frame of [':ok\n\n', 'retry: 3000\n\n']) {
    test(`a deferred handshake callback failure releases the client (${frame.trim()})`, async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      const { req, res } = createPair();
      res.write = (chunk, encoding, callback) => {
        if (chunk === frame) queueMicrotask(() => callback(new Error('handshake failed')));
        return true;
      };
      try {
        handleSSE(req, res);
        await flush();
        let later = 0;
        res.write = () => { later += 1; return true; };
        t.mock.timers.tick(60000);
        broadcast('task:updated', {});
        assert.equal(later, 0);
        assert.equal(res.destroyed, true);
      } finally { req.emit('close'); }
    });
  }

  for (const flag of ['destroyed', 'writableEnded']) {
    test(`an initially ${flag} response receives no headers or writes`, (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      const { req, res } = createPair();
      res[flag] = true;
      let attempts = 0;
      res.writeHead = res.write = () => { attempts += 1; return true; };
      try {
        handleSSE(req, res);
        t.mock.timers.tick(60000);
        broadcast('task:updated', {});
        assert.equal(attempts, 0);
      } finally { req.emit('close'); }
    });
  }

  test('healthy heartbeats retain their 30 second cadence', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { req, res } = createPair();
    const chunks = [];
    res.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      handleSSE(req, res);
      t.mock.timers.tick(29999);
      assert.equal(chunks.length, 2);
      t.mock.timers.tick(1);
      assert.equal(chunks[2], ': keepalive\n\n');
      req.emit('close');
      t.mock.timers.tick(30000);
      assert.equal(chunks.length, 3);
    } finally { req.emit('close'); }
  });

  test('a native http connection receives the handshake and one framed event', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/events') handleSSE(req, res);
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const body = await new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/api/events' }, (res) => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers['content-type'], 'text/event-stream');
          let buf = '';
          let sent = false;
          const timer = setTimeout(() => {
            req.destroy();
            reject(new Error('sse smoke timed out'));
          }, 2000);
          res.on('data', (chunk) => {
            buf += chunk;
            if (!sent && buf.includes('retry: 3000')) {
              sent = true;
              broadcast('smoke', { ok: true });
            }
            if (buf.includes('event: smoke')) {
              clearTimeout(timer);
              res.destroy();
              resolve(buf);
            }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
      });
      assert.match(body, /:ok\n\n/);
      assert.match(body, /retry: 3000\n\n/);
      assert.match(body, /id: \d+\nevent: smoke\ndata: \{"ok":true\}\n\n/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
