export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const s = url.searchParams.get('s') || '';
  const targetUrl = `https://music.163.com/api/search/suggest/web?csrf_token=&s=${encodeURIComponent(s)}`;
  
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
