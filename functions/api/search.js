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

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const s = url.searchParams.get('s') || '';
  const platform = url.searchParams.get('platform') || 'netease';
  
  if (!s) {
    return new Response(JSON.stringify({ result: { songs: [] } }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    if (platform === 'tencent') {
      const targetUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=${encodeURIComponent(s)}&format=json`;
      const response = await fetch(targetUrl, {
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      });
      const data = await response.json();
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
      return new Response(JSON.stringify({ result: { songs } }), { headers: corsHeaders });
    }
    
    if (platform === 'kuwo') {
      const targetUrl = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(s)}&ft=music&pn=0&rn=30&rformat=json&encoding=utf8`;
      const response = await fetch(targetUrl, {
        headers: {
          'Referer': 'http://www.kuwo.cn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        }
      });
      const text = await response.text();
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
      return new Response(JSON.stringify({ result: { songs } }), { headers: corsHeaders });
    }

    // Default: NetEase
    const targetUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=30&s=${encodeURIComponent(s)}`;
    const response = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
