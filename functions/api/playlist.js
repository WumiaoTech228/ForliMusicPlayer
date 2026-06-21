async function fetchNeteasePlaylistDirect(id) {
  const targetUrl = `https://music.163.com/api/v1/playlist/detail?id=${id}`;
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
      console.error(`Failed to fetch NetEase song details chunk in worker:`, e);
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
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const platform = url.searchParams.get('platform') || 'netease';
  
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }

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
      return new Response(JSON.stringify({ error: err.message || errorMsg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
