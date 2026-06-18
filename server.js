const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8'
};

http.createServer((req, res) => {
  // Handle API proxy routes to avoid browser CORS blocks
  if (req.url.startsWith('/api/')) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const apiPath = parsedUrl.pathname;
    
    if (apiPath === '/api/search') {
      const s = parsedUrl.searchParams.get('s') || '';
      const targetUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=30&s=${encodeURIComponent(s)}`;
      fetch(targetUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      })
        .then(r => r.json())
        .then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }
    
    if (apiPath === '/api/lyric') {
      const id = parsedUrl.searchParams.get('id') || '';
      const targetUrl = `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`;
      fetch(targetUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      })
        .then(r => r.json())
        .then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }
    
    if (apiPath === '/api/detail') {
      const id = parsedUrl.searchParams.get('id') || '';
      const targetUrl = `https://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`;
      fetch(targetUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      })
        .then(r => r.json())
        .then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }
    
    if (apiPath === '/api/playlist') {
      const id = parsedUrl.searchParams.get('id') || '';
      const targetUrl = `https://v.iarc.top/?server=netease&type=playlist&id=${id}`;
      fetch(targetUrl)
        .then(r => r.json())
        .then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    if (apiPath === '/api/proxy-img') {
      const imgUrl = parsedUrl.searchParams.get('url') || '';
      if (!imgUrl) {
        res.writeHead(400);
        res.end('Missing url parameter');
        return;
      }
      fetch(imgUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
          }
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          });
          return response.arrayBuffer();
        })
        .then(buffer => {
          res.end(Buffer.from(buffer));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }
  }

  // Decode URL to handle spaces or special characters
  const decodedUrl = decodeURIComponent(req.url);
  
  // Resolve absolute file path
  let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);
  
  // Clean query strings/hash from path
  const questionMarkIndex = filePath.indexOf('?');
  if (questionMarkIndex !== -1) {
    filePath = filePath.substring(0, questionMarkIndex);
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 未找到该文件</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`服务器错误: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}).listen(port, () => {
  console.log(`\n==================================================`);
  console.log(`Apple Music Web Player 本地服务启动成功!`);
  console.log(`请在浏览器中打开: http://localhost:${port}`);
  console.log(`退出服务请按: Ctrl + C`);
  console.log(`==================================================\n`);
});
