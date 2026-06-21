export async function onRequest(context) {
  const ranks = [
    { id: '3778678', name: '网易云热歌榜', platform: 'netease', desc: '网易云最热播放歌曲', cover: 'https://p2.music.126.net/GhUz9ZIXGoNsxYCcGTNPGQ==/18985266011902097.jpg' },
    { id: '19723756', name: '网易云飙升榜', platform: 'netease', desc: '网易云热度上升最快歌曲', cover: 'https://p2.music.126.net/DrRIgnsJZ96aUMe96DBuCw==/18696094659250170.jpg' },
    { id: '3779629', name: '网易云新歌榜', platform: 'netease', desc: '网易云最新上架歌曲', cover: 'https://p1.music.126.net/N2VM5j-81hbJa2UdrwZnhg==/18259588881343702.jpg' },
    { id: '4', name: 'QQ音乐流行指数榜', platform: 'tencent', desc: 'QQ音乐今日最火流行指标', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000002Neh8l0uciQZ.jpg' },
    { id: '26', name: 'QQ音乐热歌榜', platform: 'tencent', desc: 'QQ音乐全网播放热度歌曲榜', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000003DFRzD192KKD.jpg' },
    { id: '27', name: 'QQ音乐新歌榜', platform: 'tencent', desc: 'QQ音乐最新流行趋势榜', cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg' }
  ];
  return new Response(JSON.stringify({ result: ranks }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
