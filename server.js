const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db, stmts } = require('./db');

// Read HTML file once at startup
const indexHTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// MIME type map
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json'
};

// Helper: read request body and JSON.parse it
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
  });
}

// Static file server
const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(pathname, res) {
  const filePath = path.join(PUBLIC_DIR, pathname);
  // Guard against directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for unknown paths
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(indexHTML);
  }
}

// Router
const server = http.createServer(async (req, res) => {
  try {
    // JSON response helper
    res.json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    // GET / -> serve index HTML
    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(indexHTML);
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      // GET /api/tasks
      if (method === 'GET' && pathname === '/api/tasks') {
        res.json({ tasks: [] });
        return;
      }

      // POST /api/tasks
      if (method === 'POST' && pathname === '/api/tasks') {
        res.json({ ok: true }, 201);
        return;
      }

      // PATCH /api/tasks/:id
      if (method === 'PATCH' && pathname.startsWith('/api/tasks/')) {
        res.json({ ok: true });
        return;
      }

      // DELETE /api/tasks/:id
      if (method === 'DELETE' && pathname.startsWith('/api/tasks/')) {
        res.json({ ok: true });
        return;
      }

      // GET /api/events -> SSE endpoint (Plan 02 will implement)
      if (method === 'GET' && pathname === '/api/events') {
        res.json({ message: 'SSE endpoint placeholder' });
        return;
      }

      // GET /api/activity
      if (method === 'GET' && pathname === '/api/activity') {
        res.json({ activity: [] });
        return;
      }

      // GET /api/notifications
      if (method === 'GET' && pathname === '/api/notifications') {
        res.json({ notifications: [] });
        return;
      }

      // Default for /api/* -> 404
      res.json({ error: 'Not found' }, 404);
      return;
    }

    // Everything else -> static file serve
    serveStatic(pathname, res);
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(3333, '127.0.0.1', () => {
  console.log('Visionary Mission Control running at http://127.0.0.1:3333');
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  server.close();
  process.exit(0);
});
