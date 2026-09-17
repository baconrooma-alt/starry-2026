/**
 * Zero-dependency Node server:
 *  1. Serves ./public as static assets
 *  2. Share API: POST /api/share  -> create redeem-code / custom-slug share
 *               GET  /api/share/:code -> fetch shared config
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'shares.json');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
};

function loadShares() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
function saveShares(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 5 * 1024 * 1024) { req.destroy(); reject(new Error('too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // ---- API ----
  if (pathname === '/api/share' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const config = typeof body.config === 'object' && body.config ? body.config : {};
      const slug = typeof body.slug === 'string' && /^[\w\-]{2,40}$/.test(body.slug)
        ? body.slug : null;
      const code = typeof body.code === 'string' && /^[\w\-]{2,40}$/.test(body.code)
        ? body.code : null;
      const shares = loadShares();
      const key = slug || code || crypto.randomBytes(4).toString('hex');
      if (shares[key]) return send(res, 409, { ok: false, error: '该后缀/兑换码已被占用' });
      shares[key] = { config, createdAt: Date.now() };
      saveShares(shares);
      return send(res, 200, { ok: true, key });
    } catch (e) {
      return send(res, 400, { ok: false, error: '请求格式错误' });
    }
  }

  const m = pathname.match(/^\/api\/share\/([\w\-]{2,40})$/);
  if (m && req.method === 'GET') {
    const shares = loadShares();
    const hit = shares[m[1]];
    if (!hit) return send(res, 404, { ok: false, error: '兑换码不存在' });
    return send(res, 200, { ok: true, key: m[1], config: hit.config });
  }

  // ---- Static ----
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback for custom slugs like /2026-01-01-go
      const fallback = path.join(ROOT, 'index.html');
      if (fs.existsSync(fallback)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        fs.createReadStream(fallback).pipe(res);
      } else { res.writeHead(404); res.end('Not Found'); }
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => console.log(`[starry-confession] http://localhost:${PORT}`));
