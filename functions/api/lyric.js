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
    console.error('Worker Search QQ Music failed:', err.message);
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
    console.error('Worker Search NetEase failed:', err.message);
  }
  return null;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const platform = url.searchParams.get('platform') || 'netease';
  const name = url.searchParams.get('name') || '';
  const artist = url.searchParams.get('artist') || '';
  
  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  };

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id parameter' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const sendEmptyLrc = () => {
    return new Response(JSON.stringify({ lrc: { lyric: '' } }), { headers: corsHeaders });
  };
  
  const trySecondaryLyric = async () => {
    if (!name || !artist) {
      return sendEmptyLrc();
    }
    
    try {
      if (platform === 'netease') {
        console.log(`[Lyric Fallback Workers] NetEase failed. Searching tencent for ${name} - ${artist}`);
        const qqSong = await searchQQMusic(name, artist);
        if (qqSong) {
          const targetUrl = `https://v.iarc.top/?server=tencent&type=lrc&id=${qqSong.id}`;
          const r = await fetch(targetUrl);
          const lrcText = await r.text();
          if (lrcText && !lrcText.includes('未找到') && !lrcText.includes('error')) {
            return new Response(JSON.stringify({ lrc: { lyric: lrcText } }), { headers: corsHeaders });
          }
        }
      } else {
        console.log(`[Lyric Fallback Workers] Tencent failed. Searching netease for ${name} - ${artist}`);
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
            return new Response(JSON.stringify(data), { headers: corsHeaders });
          }
        }
      }
    } catch (e) {
      console.error('[Lyric Fallback Workers] Secondary lyric fetch failed:', e.message);
    }
    return sendEmptyLrc();
  };

  try {
    if (platform === 'kuwo') {
      try {
        const targetUrl = `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${id}`;
        const response = await fetch(targetUrl, {
          headers: {
            'Referer': 'https://www.kuwo.cn/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
          }
        });
        const data = await response.json();
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
          return new Response(JSON.stringify({ lrc: { lyric: lrcText } }), { headers: corsHeaders });
        }
      } catch (err) {
        console.warn('Kuwo lyric fetch failed, trying secondary fallback:', err);
      }
      return trySecondaryLyric();
    }

    if (platform === 'tencent') {
      try {
        const targetUrl = `https://v.iarc.top/?server=tencent&type=lrc&id=${id}`;
        const response = await fetch(targetUrl);
        const lrcText = await response.text();
        if (lrcText && !lrcText.includes('未找到') && !lrcText.includes('error')) {
          return new Response(JSON.stringify({ lrc: { lyric: lrcText } }), { headers: corsHeaders });
        }
      } catch (err) {
        console.warn('Tencent lyric fetch failed, trying secondary fallback:', err);
      }
      return trySecondaryLyric();
    }

    // Default: NetEase
    try {
      const targetUrl = `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`;
      const response = await fetch(targetUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      });
      const data = await response.json();
      if (data.lrc?.lyric) {
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }
    } catch (err) {
      console.warn('NetEase lyric fetch failed, trying secondary fallback:', err);
    }
    return trySecondaryLyric();

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
