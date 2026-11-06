// Minimal static server for test-pages/ (http://localhost:5179/attach-test.html).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('test-pages');
export const PORT = Number(process.env.PORT ?? 5179);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

export function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const rel = url.pathname === '/' ? 'attach-test.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('serve-test-page.mjs')) {
  await startServer();
  console.log(`Test page: http://localhost:${PORT}/attach-test.html?case=plain|hidden|dropzone|iframe`);
}
