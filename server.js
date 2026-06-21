const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 全局禁用 TLS 证书校验以提升兼容性
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 洛雪宿主环境状态
let lxRequestHandler = null;

function loadBestChangqingSource() {
  const apiTarget = path.join(__dirname, 'functions', 'api', 'Musicsources.js');
  if (fs.existsSync(apiTarget)) {
    console.log(`[LX Host] Found local script at ./functions/api/Musicsources.js`);
    return { path: apiTarget, version: '1.2.0' };
  }

  const localDir = path.join(__dirname, 'sources');
  const externalDir = 'D:/Voider3/Music/音源';
  
  // 1. Check if the renamed local file exists
  const localTarget = path.join(localDir, 'changqing-svip.js');
  if (fs.existsSync(localTarget)) {
    console.log(`[LX Host] Found local Changqing SVIP script at ./sources/changqing-svip.js`);
    return { path: localTarget, version: '1.2.0' };
  }

  // 2. Otherwise, check local sources folder for files matching the name
  let dir = localDir;
  if (!fs.existsSync(localDir) || fs.readdirSync(localDir).filter(f => f.endsWith('.js')).length === 0) {
    console.log(`[LX Host] Local sources folder not found or empty. Falling back to external path: ${externalDir}`);
    dir = externalDir;
  }

  if (!fs.existsSync(dir)) {
    console.warn(`[LX Host] Warning: Directory ${dir} not found. Custom SVIP sources skipped.`);
    return null;
  }

  const files = fs.readdirSync(dir);
  let bestFile = null;
  let maxVer = '0.0.0';

  const compareVersions = (v1, v2) => {
    const p = v => v.replace(/[^\d.]+/g, c => '.' + (c.replace(/[\W_]+/, '').toUpperCase().charCodeAt(0) - 65536) + '.').replace(/(?:\.0+)*(\.-\d+(?:\.\d+)?)\.*$/g, '$1').split('.');
    const a = p(v1), b = p(v2);
    const l = Math.max(a.length, b.length);
    for (let i = 0; i < l; i++) {
      let r = ~~a[i] - ~~b[i];
      if (r !== 0) return r > 0 ? 1 : -1;
    }
    return 0;
  };

  files.forEach(f => {
    if (f.startsWith('【推荐】长青SVIP音源') || f.startsWith('长青SVIP音源') || f.includes('长青SVIP音源') || f === 'changqing-svip.js') {
      if (f.endsWith('.js')) {
        let version = '1.0.0';
        const match = f.match(/v?(\d+\.\d+\.\d+)/i);
        if (match) {
          version = match[1];
        } else {
          try {
            const content = fs.readFileSync(path.join(dir, f), 'utf8').substring(0, 500);
            const vMatch = content.match(/@version\s+(\d+\.\d+\.\d+)/);
            if (vMatch) version = vMatch[1];
          } catch(e) {}
        }

        if (compareVersions(version, maxVer) > 0) {
          maxVer = version;
          bestFile = path.join(dir, f);
        }
      }
    }
  });

  if (bestFile) {
    console.log(`[LX Host] Found best Changqing SVIP script: ${path.basename(bestFile)} (v${maxVer}) in ${dir === localDir ? 'local sources/' : 'external folder'}`);
    return { path: bestFile, version: maxVer };
  }
  return null;
}

function initLxHost() {
  const sourceInfo = loadBestChangqingSource();
  if (!sourceInfo) return;

  const EVENT_NAMES = {
    inited: 'inited',
    request: 'request',
    updateAlert: 'updateAlert'
  };

  const md5 = str => crypto.createHash('md5').update(str).digest('hex');
  const aesEncrypt = (data, mode, key, iv) => {
    const alg = mode.includes('ecb') ? 'aes-128-ecb' : 'aes-128-cbc';
    const cipher = crypto.createCipheriv(alg, Buffer.from(key), iv ? Buffer.from(iv) : Buffer.alloc(0));
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return encrypted;
  };

  globalThis.lx = {
    EVENT_NAMES,
    version: '2.5.0',
    currentScriptInfo: {
      rawScript: ''
    },
    on: (event, handler) => {
      if (event === 'request') {
        lxRequestHandler = handler;
      }
    },
    send: (event, data) => {
      if (event === EVENT_NAMES.updateAlert) {
        console.warn(`\n==================================================`);
        console.warn(`⚠️ [长青音源更新提示]: ${data.log || '有新版本可更新'}`);
        console.warn(`更新地址: ${data.updateUrl || ''}`);
        console.warn(`==================================================\n`);
      }
    },
    utils: {
      buffer: {
        from: (data, encoding) => Buffer.from(data, encoding),
        bufToString: (buf, format) => Buffer.from(buf).toString(format)
      },
      crypto: {
        aesEncrypt,
        md5,
        randomBytes: (size) => crypto.randomBytes(size),
        rsaEncrypt: (data, key) => {
          return crypto.publicEncrypt(key, Buffer.from(data));
        }
      }
    },
    request: (url, options, callback) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      const method = options.method || 'GET';
      const headers = options.headers || {};
      let body = options.body;
      if (options.form) {
        body = Object.entries(options.form)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (typeof body === 'object') {
        body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
      const timeout = options.timeout || 4000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      fetch(url, { method, headers, body, signal: controller.signal })
        .then(async (res) => {
          clearTimeout(timeoutId);
          const text = await res.text();
          let parsedBody = text;
          try {
            parsedBody = JSON.parse(text);
          } catch (e) {}
          callback(null, {
            statusCode: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            body: parsedBody
          }, parsedBody);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          callback(err, null, null);
        });
    }
  };

  try {
    const code = fs.readFileSync(sourceInfo.path, 'utf8');
    globalThis.lx.currentScriptInfo.rawScript = code;
    new Function(code)();
    console.log(`[LX Host] Custom Changqing SVIP source initialized successfully.`);
  } catch (err) {
    console.error(`[LX Host] Failed to run Changqing SVIP script:`, err.message);
  }
}

async function tryLxSource(platform, id, name = '', artist = '') {
  if (!lxRequestHandler) return null;
  const platformMap = {
    netease: 'wy',
    tencent: 'tx',
    kuwo: 'kw'
  };
  const lxPlatform = platformMap[platform] || 'wy';
  
  try {
    console.log(`[LX Host] Resolving URL via local SVIP source for ${platform} ID: ${id} (${name} - ${artist})`);
    const musicInfo = {
      musicInfo: {
        id: id,
        songmid: id,
        strMediaMid: id,
        albumId: '',
        hash: id,
        name: name,
        singer: artist,
        artist: artist,
        songname: name
      },
      type: '128k'
    };
    
    const p = lxRequestHandler({
      source: lxPlatform,
      action: 'musicUrl',
      info: musicInfo
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Resolve timeout')), 5000)
    );

    const url = await Promise.race([p, timeoutPromise]);
    if (url && url.startsWith('http')) {
      console.log(`[LX Host] SVIP source successfully resolved URL: ${url}`);
      return url;
    }
  } catch (err) {
    console.error(`[LX Host] SVIP source resolution failed:`, err.message);
  }
  return null;
}

function isSongMatch(name1, artist1, name2, artist2) {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().replace(/\s+/g, '').replace(/[\(\)（）]/g, '');
  const n2 = name2.toLowerCase().replace(/\s+/g, '').replace(/[\(\)（）]/g, '');
  
  const titleMatch = n1.includes(n2) || n2.includes(n1);
  if (!titleMatch) return false;
  
  if (artist1 && artist2) {
    const a1 = artist1.toLowerCase().replace(/\s+/g, '');
    const a2 = artist2.toLowerCase().replace(/\s+/g, '');
    const artistMatch = a1.includes(a2) || a2.includes(a1);
    if (!artistMatch) return false;
  }
  return true;
}

async function searchQQMusic(name, artist) {
  const query = `${name} ${artist}`.trim();
  const targetUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=${encodeURIComponent(query)}&format=json`;
  try {
    const r = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    const data = await r.json();
    const list = data.data?.song?.list || [];
    if (list.length > 0) {
      const match = list.find(s => {
        const sName = cleanHtmlEntities(s.songname);
        const sArtist = (s.singer || []).map(a => cleanHtmlEntities(a.name)).join('/');
        return isSongMatch(name, artist, sName, sArtist);
      }) || list[0];
      return {
        id: match.songmid,
        name: cleanHtmlEntities(match.songname),
        artist: (match.singer || []).map(a => cleanHtmlEntities(a.name)).join('/')
      };
    }
  } catch (err) {
    console.error('Search QQ Music failed:', err.message);
  }
  return null;
}

async function searchNetEase(name, artist) {
  const query = `${name} ${artist}`.trim();
  const targetUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=10&s=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    const data = await r.json();
    const list = data.result?.songs || [];
    if (list.length > 0) {
      const match = list.find(s => {
        const sName = cleanHtmlEntities(s.name);
        const sArtist = (s.artists || []).map(a => cleanHtmlEntities(a.name)).join('/');
        return isSongMatch(name, artist, sName, sArtist);
      }) || list[0];
      return {
        id: match.id,
        name: cleanHtmlEntities(match.name),
        artist: (match.artists || []).map(a => cleanHtmlEntities(a.name)).join('/')
      };
    }
  } catch (err) {
    console.error('Search NetEase failed:', err.message);
  }
  return null;
}

async function resolveTencentUrl(id, name, artist, customSource) {
  // 1. 本地长青音源
  const lxUrl = await tryLxSource('tencent', id, name, artist);
  if (lxUrl) return lxUrl;
  
  // 2. 自定义洛雪在线源
  if (customSource) {
    const customUrl = await tryCustomLxSource(customSource, 'tencent', id);
    if (customUrl) return customUrl;
  }
  
  // 3. Charity nodes
  try {
    const charityUrl = await tryCharityNodes('tencent', id);
    if (charityUrl) return charityUrl;
  } catch (err) {
    console.error('QQ Music Charity node failed:', err.message);
  }
  
  // 4. 官方原生解析
  const filename = `C400${id}.m4a`;
  const guid = '811228228';
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        filename: [filename],
        guid: guid,
        songmid: [id],
        songtype: [0],
        uin: '0',
        loginflag: 1,
        platform: '20'
      }
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 }
  };
  const targetUrl = `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    const r = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    const data = await r.json();
    const purl = data.req_0?.data?.midurlinfo?.[0]?.purl;
    if (purl) {
      return `http://ws.stream.qqmusic.qq.com/${purl}`;
    }
  } catch (err) {
    console.error('Direct QQ Music URL resolve failed:', err.message);
  }
  
  return null;
}

async function resolveNeteaseUrl(id, name, artist, customSource) {
  // 1. 本地长青音源
  const lxUrl = await tryLxSource('netease', id, name, artist);
  if (lxUrl) return lxUrl;
  
  // 2. 自定义洛雪在线源
  if (customSource) {
    const customUrl = await tryCustomLxSource(customSource, 'netease', id);
    if (customUrl) return customUrl;
  }
  
  // 3. Charity nodes
  try {
    const charityUrl = await tryCharityNodes('netease', id);
    if (charityUrl) return charityUrl;
  } catch (err) {
    console.error('NetEase Charity node failed:', err.message);
  }
  
  // 4. Standard stream
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

// 初始化本地洛雪环境
initLxHost();

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

// 辅助函数：清除 HTML 实体字符
function cleanHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 辅助函数：解析酷我伪 JSON
function parseKuwoJson(text) {
  try {
    return new Function(`return ${text}`)();
  } catch (e) {
    console.error('Failed to parse Kuwo pseudo-JSON via Function:', e);
    try {
      const formatted = text.replace(/'/g, '"');
      return JSON.parse(formatted);
    } catch (e2) {
      return null;
    }
  }
}


// 辅助函数：尝试通过前端传入的自定义洛雪源解析直链
async function tryCustomLxSource(customSource, platform, id) {
  if (!customSource) return null;
  const platformMap = {
    netease: 'wy',
    tencent: 'qq',
    kuwo: 'kw'
  };
  const lxPlatform = platformMap[platform] || 'wy';
  const cleanSource = customSource.replace(/\/+$/, '');
  const url = `${cleanSource}/url/${lxPlatform}/${id}/128k`;
  
  try {
    console.log(`[LX Custom] Fetching custom source: ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeoutId);

    if (res.status === 200) {
      const data = await res.json();
      let audioUrl = data?.data || data?.url;
      if (audioUrl && audioUrl.startsWith('http')) {
        console.log(`[LX Custom] Successfully resolved URL: ${audioUrl}`);
        return audioUrl;
      }
    }
  } catch (e) {
    console.error(`[LX Custom] Request failed: ${e.message}`);
  }
  return null;
}

// 辅助函数：从酷我搜索候选中挑选最佳时长与歌名歌手契合的歌曲
function selectBestKuwoSong(list, targetName, targetArtist) {
  if (!list || list.length === 0) return null;

  const targetNameLower = targetName.toLowerCase().trim();
  const targetArtistLower = targetArtist.toLowerCase().trim();

  const noiseWords = ['伴奏', 'ktv', 'instrumental', '纯音乐', '铃声', '彩铃', '翻唱', 'cover', '八倍镜', '加速', '慢速', 'dj', 'remix', '片段', 'demo', '试听', '伴奏版'];

  let bestSong = null;
  let maxScore = -1000;

  for (const song of list) {
    const rawSongName = song.SONGNAME || song.NAME || '';
    const rawArtist = song.ARTIST || '';
    const duration = parseInt(song.DURATION) || 0;

    if (duration < 90 || duration > 480) {
      continue;
    }

    let score = 100;

    const songNameClean = cleanHtmlEntities(rawSongName).toLowerCase().trim();
    const artistClean = cleanHtmlEntities(rawArtist).toLowerCase().trim();

    // 1. 歌手匹配
    const hasArtistMatch = artistClean.includes(targetArtistLower) || targetArtistLower.includes(artistClean);
    if (!hasArtistMatch) {
      score -= 40;
    }

    // 2. 干扰词扣分
    for (const word of noiseWords) {
      if (songNameClean.includes(word) || artistClean.includes(word)) {
        if (word === '伴奏' || word === 'ktv' || word === 'instrumental' || word === '伴奏版') {
          score -= 30;
        } else if (word === '片段' || word === '彩铃' || word === '铃声' || word === 'demo' || word === '试听') {
          score -= 50;
        } else if (word === 'cover' || word === '翻唱') {
          score -= 25;
        } else if (word === 'dj' || word === 'remix') {
          score -= 20;
        } else {
          score -= 15;
        }
      }
    }

    // 3. 歌名匹配度
    const songNameBase = songNameClean.replace(/\s*[\(\（].*?[\)\）]\s*/g, '').trim();
    if (songNameBase === targetNameLower) {
      score += 20;
    } else if (songNameClean.includes(targetNameLower)) {
      score += 5;
    } else {
      score -= 30;
    }

    if (songNameClean.length > targetNameLower.length + 15) {
      score -= 40;
    }

    if (score > maxScore) {
      maxScore = score;
      bestSong = song;
    }
  }

  if (bestSong && maxScore >= -100) {
    console.log(`[Best Match] Selected: ${bestSong.SONGNAME} - ${bestSong.ARTIST} (Duration: ${bestSong.DURATION}s, Score: ${maxScore})`);
    return bestSong;
  }
  
  console.log(`[Best Match] No qualified song found on Kuwo.`);
  return null;
}

// 辅助函数：QQ音乐 VIP 歌曲自动降级播放酷我音乐源
function fallbackToKuwo(name, artist, res) {
  if (!name) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('Song name missing for fallback');
    return;
  }
  const query = `${name} ${artist}`.trim();
  const searchUrl = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(query)}&ft=music&pn=0&rn=10&rformat=json&encoding=utf8`;
  
  fetch(searchUrl, {
    headers: {
      'Referer': 'http://www.kuwo.cn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
    }
  })
    .then(r => r.text())
    .then(text => {
      const data = parseKuwoJson(text);
      const song = selectBestKuwoSong(data?.abslist || [], name, artist);
      if (song) {
        const rid = song.MUSICRID.replace('MUSIC_', '');
        const playUrl = `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${rid}&format=mp3&response=url`;
        fetch(playUrl)
          .then(r2 => r2.text())
          .then(streamUrl => {
            if (streamUrl && streamUrl.startsWith('http')) {
              console.log(`Fallback success: redirected to Kuwo stream for ${query}`);
              res.writeHead(302, { 'Location': streamUrl, 'Access-Control-Allow-Origin': '*' });
              res.end();
            } else {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
              res.end('Fallback stream not found');
            }
          })
          .catch(err => {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(err.message);
          });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('Fallback song not found in Kuwo');
      }
    })
    .catch(err => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(err.message);
    });
}

const CHARITY_NODES = [
  'https://api.injahow.cn/meting/',
  'https://v.iarc.top/',
  'https://api.zw95.net/'
];

// 辅助函数：尝试通过公益 VIP 节点获取播放直链
async function tryCharityNodes(platform, id) {
  for (const nodeBase of CHARITY_NODES) {
    const url = `${nodeBase}?server=${platform}&type=url&id=${id}`;
    try {
      console.log(`[Charity] Trying node: ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);

      if (response.status === 302 || response.status === 301) {
        const location = response.headers.get('location');
        if (location && location.startsWith('http') && !location.includes('music.qq.com/placeholder.mp3')) {
          console.log(`[Charity] Success via redirect: ${location}`);
          return location;
        }
      }

      if (response.status === 200) {
        const text = await response.text();
        if (text) {
          try {
            const data = JSON.parse(text);
            const itemUrl = data?.url || data?.[0]?.url;
            if (itemUrl && itemUrl.startsWith('http') && !itemUrl.includes('music.qq.com/placeholder.mp3')) {
              console.log(`[Charity] Success via JSON: ${itemUrl}`);
              return itemUrl;
            }
          } catch (je) {
            const trimmed = text.trim();
            if (trimmed.startsWith('http') && !trimmed.includes('music.qq.com/placeholder.mp3')) {
              console.log(`[Charity] Success via text: ${trimmed}`);
              return trimmed;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Charity] Node ${nodeBase} failed or timed out: ${err.message}`);
    }
  }
  console.log(`[Charity] All nodes failed for ${platform} ID: ${id}`);
  return null;
}

http.createServer(async (req, res) => {
  // Handle API proxy routes to avoid browser CORS blocks
  if (req.url.startsWith('/api/')) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const apiPath = parsedUrl.pathname;
    if (apiPath === '/api/log-error') {
      const msg = parsedUrl.searchParams.get('msg') || '';
      const stack = parsedUrl.searchParams.get('stack') || '';
      console.error(`[BROWSER ERROR] ${msg}\nStack: ${stack}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (apiPath === '/api/suggest') {
      const s = parsedUrl.searchParams.get('s') || '';
      const targetUrl = `https://music.163.com/api/search/suggest/web?csrf_token=&s=${encodeURIComponent(s)}`;
      
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

    if (apiPath === '/api/recommend-playlists') {
      const targetUrl = 'https://music.163.com/api/playlist/list?cat=全部&order=hot&offset=0&limit=15';
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

    if (apiPath === '/api/ranks') {
      const ranks = [
        { id: '3778678', name: '网易云热歌榜', platform: 'netease', desc: '网易云最热播放歌曲', cover: 'https://p2.music.126.net/GhUz9ZIXGoNsxYCcGTNPGQ==/18985266011902097.jpg' },
        { id: '19723756', name: '网易云飙升榜', platform: 'netease', desc: '网易云热度上升最快歌曲', cover: 'https://p2.music.126.net/DrRIgnsJZ96aUMe96DBuCw==/18696094659250170.jpg' },
        { id: '3779629', name: '网易云新歌榜', platform: 'netease', desc: '网易云最新上架歌曲', cover: 'https://p1.music.126.net/N2VM5j-81hbJa2UdrwZnhg==/18259588881343702.jpg' },
        { id: '4', name: 'QQ音乐流行指数榜', platform: 'tencent', desc: 'QQ音乐今日最火流行指标', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000002Neh8l0uciQZ.jpg' },
        { id: '26', name: 'QQ音乐热歌榜', platform: 'tencent', desc: 'QQ音乐全网播放热度歌曲榜', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000003DFRzD192KKD.jpg' },
        { id: '27', name: 'QQ音乐新歌榜', platform: 'tencent', desc: 'QQ音乐最新流行趋势榜', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg' }
      ];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ result: ranks }));
      return;
    }

    if (apiPath === '/api/search') {
      const s = parsedUrl.searchParams.get('s') || '';
      const platform = parsedUrl.searchParams.get('platform') || 'netease';
      
      if (platform === 'tencent') {
        const targetUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=${encodeURIComponent(s)}&format=json`;
        fetch(targetUrl, {
          headers: {
            'Referer': 'https://y.qq.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
          }
        })
          .then(r => r.json())
          .then(data => {
            const list = data.data?.song?.list || [];
            const songs = list.map(song => ({
              id: song.songmid,
              name: cleanHtmlEntities(song.songname),
              artists: (song.singer || []).map(art => ({ name: cleanHtmlEntities(art.name) })),
              album: {
                name: cleanHtmlEntities(song.albumname),
                picUrl: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${song.albummid}.jpg`
              },
              platform: 'tencent'
            }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ result: { songs } }));
          })
          .catch(err => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err.message }));
          });
        return;
      }
      
      if (platform === 'kuwo') {
        const targetUrl = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(s)}&ft=music&pn=0&rn=30&rformat=json&encoding=utf8`;
        fetch(targetUrl, {
          headers: {
            'Referer': 'http://www.kuwo.cn/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
          }
        })
          .then(r => r.text())
          .then(text => {
            const data = parseKuwoJson(text);
            const list = data?.abslist || [];
            const songs = list.map(song => {
              const rid = song.MUSICRID.replace('MUSIC_', '');
              const shortPath = song.web_albumpic_short ? song.web_albumpic_short.replace(/^\d+\//, '') : '';
              const picUrl = shortPath ? `https://img3.kuwo.cn/star/albumcover/500/${shortPath}` : '';
              return {
                id: rid,
                name: cleanHtmlEntities(song.NAME || song.SONGNAME),
                artists: [{ name: cleanHtmlEntities(song.ARTIST) }],
                album: {
                  name: cleanHtmlEntities(song.ALBUM || ''),
                  picUrl: picUrl
                },
                platform: 'kuwo'
              };
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ result: { songs } }));
          })
          .catch(err => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err.message }));
          });
        return;
      }
      
      // Default: NetEase
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
      const platform = parsedUrl.searchParams.get('platform') || 'netease';
      const name = parsedUrl.searchParams.get('name') || '';
      const artist = parsedUrl.searchParams.get('artist') || '';
      
      const sendEmptyLrc = () => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ lrc: { lyric: '' } }));
      };
      
      const trySecondaryLyric = async () => {
        if (!name || !artist) {
          sendEmptyLrc();
          return;
        }
        
        try {
          if (platform === 'netease') {
            console.log(`[Lyric Fallback] NetEase failed. Searching tencent for ${name} - ${artist}`);
            const qqSong = await searchQQMusic(name, artist);
            if (qqSong) {
              const targetUrl = `https://v.iarc.top/?server=tencent&type=lrc&id=${qqSong.id}`;
              const r = await fetch(targetUrl);
              const lrcText = await r.text();
              if (lrcText && !lrcText.includes('未找到') && !lrcText.includes('error')) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ lrc: { lyric: lrcText } }));
                return;
              }
            }
          } else {
            console.log(`[Lyric Fallback] Tencent failed. Searching netease for ${name} - ${artist}`);
            const neSong = await searchNetEase(name, artist);
            if (neSong) {
              const targetUrl = `https://music.163.com/api/song/lyric?id=${neSong.id}&lv=1&kv=1&tv=-1`;
              const r = await fetch(targetUrl, {
                headers: {
                  'Referer': 'https://music.163.com',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              });
              const data = await r.json();
              if (data.lrc?.lyric) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(data));
                return;
              }
            }
          }
        } catch (e) {
          console.error('[Lyric Fallback] Secondary lyric fetch failed:', e.message);
        }
        sendEmptyLrc();
      };
      
      if (platform === 'kuwo') {
        const targetUrl = `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${id}`;
        fetch(targetUrl, {
          headers: {
            'Referer': 'https://www.kuwo.cn/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
          }
        })
          .then(r => r.json())
          .then(data => {
            const lrclist = data.data?.lrclist || [];
            const lrcText = lrclist.map(item => {
              const t = parseFloat(item.time);
              const m = Math.floor(t / 60);
              const s = Math.floor(t % 60);
              const ms = Math.floor((t % 1) * 100);
              const timeStr = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}]`;
              return `${timeStr}${item.lineLyric}`;
            }).join('\n');

            if (lrcText) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ lrc: { lyric: lrcText } }));
            } else {
              trySecondaryLyric();
            }
          })
          .catch(err => {
            trySecondaryLyric();
          });
        return;
      }
      
      if (platform === 'tencent') {
        const targetUrl = `https://v.iarc.top/?server=tencent&type=lrc&id=${id}`;
        fetch(targetUrl)
          .then(r => r.text())
          .then(lrcText => {
            if (lrcText && !lrcText.includes('未找到') && !lrcText.includes('error')) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ lrc: { lyric: lrcText } }));
            } else {
              trySecondaryLyric();
            }
          })
          .catch(err => {
            trySecondaryLyric();
          });
        return;
      }
      
      // Default: NetEase
      const targetUrl = `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`;
      fetch(targetUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      })
        .then(r => r.json())
        .then(data => {
          if (data.lrc?.lyric) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
          } else {
            trySecondaryLyric();
          }
        })
        .catch(err => {
          trySecondaryLyric();
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
      const platform = parsedUrl.searchParams.get('platform') || 'netease';

      const fetchNeteasePlaylistDirect = async (playlistId) => {
        const targetUrl = `https://music.163.com/api/v1/playlist/detail?id=${playlistId}`;
        const response = await fetch(targetUrl, {
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
          }
        });
        if (!response.ok) throw new Error(`NetEase API returned status ${response.status}`);
        const data = await response.json();
        if (data.code !== 200 || !data.playlist) {
          throw new Error(data.message || 'Failed to fetch playlist detail from NetEase');
        }
        
        const trackIds = (data.playlist.trackIds || []).map(t => t.id);
        if (trackIds.length === 0) {
          return [];
        }

        let allTracks = [];
        const chunkSize = 100;
        for (let i = 0; i < trackIds.length; i += chunkSize) {
          const chunk = trackIds.slice(i, i + chunkSize);
          const detailUrl = `https://music.163.com/api/song/detail?ids=[${chunk.join(',')}]`;
          try {
            const detailRes = await fetch(detailUrl, {
              headers: {
                'Referer': 'https://music.163.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
              }
            });
            if (detailRes.ok) {
              const detailData = await detailRes.json();
              if (detailData.songs && Array.isArray(detailData.songs)) {
                allTracks = allTracks.concat(detailData.songs);
              }
            }
          } catch (e) {
            console.error(`Failed to fetch NetEase song details chunk:`, e);
          }
        }

        if (allTracks.length === 0) {
          allTracks = data.playlist.tracks || [];
        }
        
        return allTracks.map(track => {
          const artistName = track.ar ? track.ar.map(a => a.name).join(' / ') : (track.artists ? track.artists.map(a => a.name).join(' / ') : '未知歌手');
          const picUrl = track.al?.picUrl || track.album?.picUrl || 'assets/default.svg';
          return {
            id: track.id,
            name: track.name,
            artist: artistName,
            pic: picUrl,
            url: `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`,
            lrc: `https://music.163.com/api/song/media/outer/url?id=${track.id}.mp3`
          };
        });
      };

      const respondWithJson = (data, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      };

      const handleRequest = async () => {
        let data = null;
        let errorMsg = '';

        if (platform === 'netease') {
          try {
            data = await fetchNeteasePlaylistDirect(id);
          } catch (err) {
            console.warn("Direct NetEase playlist fetch failed, trying Meting API fallback...", err);
            errorMsg = err.message;
          }
        }

        if (!data) {
          const targetUrl = `https://v.iarc.top/?server=${platform}&type=playlist&id=${id}`;
          try {
            const response = await fetch(targetUrl);
            if (!response.ok) throw new Error(`Meting API returned status ${response.status}`);
            data = await response.json();
          } catch (err) {
            respondWithJson({ error: err.message || errorMsg }, 500);
            return;
          }
        }

        respondWithJson(data);
      };

      handleRequest();
      return;
    }
    
    if (apiPath === '/api/url') {
      const platform = parsedUrl.searchParams.get('platform') || 'netease';
      const id = parsedUrl.searchParams.get('id') || '';
      const name = parsedUrl.searchParams.get('name') || '';
      const artist = parsedUrl.searchParams.get('artist') || '';
      const customSource = parsedUrl.searchParams.get('custom_source') || '';

      console.log(`[URL Request] Requested: platform=${platform}, id=${id}, name=${name}, artist=${artist}`);

      let playUrl = null;
      let resolvedPlatform = '';

      if (platform === 'tencent') {
        // Try QQ Music first
        playUrl = await resolveTencentUrl(id, name, artist, customSource);
        if (playUrl) {
          resolvedPlatform = 'tencent';
        } else {
          console.log(`[URL Fallback] QQ Music failed. Attempting fallback to NetEase for ${name} - ${artist}`);
          const neSong = await searchNetEase(name, artist);
          if (neSong) {
            playUrl = await resolveNeteaseUrl(neSong.id, neSong.name, neSong.artist, customSource);
            if (playUrl) resolvedPlatform = 'netease';
          }
        }
      } else if (platform === 'netease') {
        // Try NetEase first as requested
        playUrl = await resolveNeteaseUrl(id, name, artist, customSource);
        if (playUrl) {
          resolvedPlatform = 'netease';
        } else {
          console.log(`[URL Fallback] NetEase failed. Attempting fallback to QQ Music for ${name} - ${artist}`);
          const qqSong = await searchQQMusic(name, artist);
          if (qqSong) {
            playUrl = await resolveTencentUrl(qqSong.id, qqSong.name, qqSong.artist, customSource);
            if (playUrl) resolvedPlatform = 'tencent';
          }
        }
      } else {
        // Other / fallback
        playUrl = await resolveNeteaseUrl(id, name, artist, customSource);
        if (playUrl) resolvedPlatform = 'netease';
      }

      if (playUrl) {
        console.log(`[URL Resolve Success] Routed to platform=${resolvedPlatform}, URL=${playUrl}`);
        res.writeHead(302, { 'Location': playUrl, 'Access-Control-Allow-Origin': '*' });
        res.end();
      } else {
        console.log(`[URL Resolve Failed] No source found for ${name} - ${artist}`);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('Audio URL not found');
      }
      return;
    }

    if (apiPath === '/api/proxy-audio') {
      const urlParam = parsedUrl.searchParams.get('url');
      if (!urlParam) {
        res.writeHead(400);
        res.end('Missing url parameter');
        return;
      }

      console.log(`[Audio Proxy] Fetching: ${urlParam}`);
      let finalUrl = urlParam;
      if (finalUrl.startsWith('/')) {
        finalUrl = `http://localhost:${port}` + finalUrl;
      }
      fetch(finalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      .then(response => {
        const headers = {
          'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Accept-Ranges': 'bytes'
        };

        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          headers['Content-Length'] = contentLength;
        }

        res.writeHead(response.status, headers);

        if (!response.body) {
          res.end();
          return;
        }

        const reader = response.body.getReader();
        function push() {
          reader.read().then(({ done, value }) => {
            if (done) {
              res.end();
              return;
            }
            res.write(Buffer.from(value));
            push();
          }).catch(err => {
            console.error('[Audio Proxy] Error reading stream:', err);
            res.end();
          });
        }
        push();
      })
      .catch(err => {
        console.error('[Audio Proxy] Fetch error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end(err.message);
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

      async function fetchWithRedirect(url, depth = 0) {
        if (depth > 5) {
          throw new Error('Too many redirects');
        }
        const isNetease = url.includes('music.126.net') || url.includes('126.net') || url.includes('music.163.com');
        const isQQ = url.includes('gtimg.cn');
        const isKuwo = url.includes('kuwo.cn');
        
        const headers = {};
        if (isNetease) {
          headers['Referer'] = 'https://music.163.com';
        } else if (isQQ) {
          headers['Referer'] = 'https://y.qq.com/';
        } else if (isKuwo) {
          headers['Referer'] = 'http://www.kuwo.cn/';
        }
        
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

        const response = await fetch(url, {
          headers,
          redirect: 'manual'
        });

        if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
          const redirectUrl = response.headers.get('location');
          if (redirectUrl) {
            const resolvedUrl = new URL(redirectUrl, url).toString();
            return fetchWithRedirect(resolvedUrl, depth + 1);
          }
        }
        return response;
      }

      fetchWithRedirect(imgUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
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
