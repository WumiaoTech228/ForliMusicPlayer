export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const s = url.searchParams.get('s') || '';
  
  if (!s) {
    return new Response(JSON.stringify({ result: { songs: [] } }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const targetUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=30&s=${encodeURIComponent(s)}`;
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) throw new Error(`NetEase API returned status ${response.status}`);
    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
