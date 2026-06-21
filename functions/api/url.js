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
    let formatted = text
      .replace(/([\{\s,])(\w+)(:)/g, '$1"$2"$3')
      .replace(/'/g, '"');
    return JSON.parse(formatted);
  } catch (e) {
    console.error('Failed to parse Kuwo pseudo-JSON in Worker:', e);
    return null;
  }
}

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
    return bestSong;
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

async function resolveTencentUrl(id, name, artist, customSource) {
  // 1. 自定义洛雪在线源
  if (customSource) {
    const customUrl = await tryCustomLxSource(customSource, 'tencent', id);
    if (customUrl) return customUrl;
  }
  
  // 2. Charity nodes
  try {
    const charityUrl = await tryCharityNodes('tencent', id);
    if (charityUrl) return charityUrl;
  } catch (err) {
    console.error('Worker QQ Music Charity node failed:', err.message);
  }
  
  // 3. 官方原生解析
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
    console.error('Worker Direct QQ Music URL resolve failed:', err.message);
  }
  
  return null;
}

async function resolveNeteaseUrl(id, name, artist, customSource) {
  // 1. 自定义洛雪在线源
  if (customSource) {
    const customUrl = await tryCustomLxSource(customSource, 'netease', id);
    if (customUrl) return customUrl;
  }
  
  // 2. Charity nodes
  try {
    const charityUrl = await tryCharityNodes('netease', id);
    if (charityUrl) return charityUrl;
  } catch (err) {
    console.error('Worker NetEase Charity node failed:', err.message);
  }
  
  // 3. Standard stream
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

const CHARITY_NODES = [
  'https://api.injahow.cn/meting/',
  'https://v.iarc.top/',
  'https://api.zw95.net/'
];

async function tryCharityNodes(platform, id) {
  for (const nodeBase of CHARITY_NODES) {
    const url = `${nodeBase}?server=${platform}&type=url&id=${id}`;
    try {
      console.log(`[Charity Pages] Trying node: ${url}`);
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
          console.log(`[Charity Pages] Success via redirect: ${location}`);
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
              console.log(`[Charity Pages] Success via JSON: ${itemUrl}`);
              return itemUrl;
            }
          } catch (je) {
            const trimmed = text.trim();
            if (trimmed.startsWith('http') && !trimmed.includes('music.qq.com/placeholder.mp3')) {
              console.log(`[Charity Pages] Success via text: ${trimmed}`);
              return trimmed;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Charity Pages] Node ${nodeBase} failed or timed out: ${err.message}`);
    }
  }
  return null;
}

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
    console.log(`[LX Custom Pages] Fetching custom source: ${url}`);
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
        return audioUrl;
      }
    }
  } catch (e) {
    console.error(`[LX Custom Pages] Request failed: ${e.message}`);
  }
  return null;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'netease';
  const id = url.searchParams.get('id') || '';
  const name = url.searchParams.get('name') || '';
  const artist = url.searchParams.get('artist') || '';
  const customSource = url.searchParams.get('custom_source') || '';

  console.log(`[Worker Request] platform=${platform}, id=${id}, name=${name}, artist=${artist}`);

  let playUrl = null;

  if (platform === 'tencent') {
    // Try QQ Music first
    playUrl = await resolveTencentUrl(id, name, artist, customSource);
    if (!playUrl) {
      console.log(`[Worker Fallback] QQ Music failed. Attempting fallback to NetEase for ${name} - ${artist}`);
      const neSong = await searchNetEase(name, artist);
      if (neSong) {
        playUrl = await resolveNeteaseUrl(neSong.id, neSong.name, neSong.artist, customSource);
      }
    }
  } else if (platform === 'netease') {
    // Try NetEase first as requested
    playUrl = await resolveNeteaseUrl(id, name, artist, customSource);
    if (!playUrl) {
      console.log(`[Worker Fallback] NetEase failed. Attempting fallback to QQ Music for ${name} - ${artist}`);
      const qqSong = await searchQQMusic(name, artist);
      if (qqSong) {
        playUrl = await resolveTencentUrl(qqSong.id, qqSong.name, qqSong.artist, customSource);
      }
    }
  } else {
    // Other / fallback
    playUrl = await resolveNeteaseUrl(id, name, artist, customSource);
  }

  if (playUrl) {
    return Response.redirect(playUrl, 302);
  } else {
    return new Response('Audio URL not found', { status: 404 });
  }
}
