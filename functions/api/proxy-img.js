export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const imgUrl = url.searchParams.get('url') || '';
  
  if (!imgUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }
  
  try {
    const isNetease = imgUrl.includes('music.126.net') || imgUrl.includes('126.net') || imgUrl.includes('music.163.com');
    const isQQ = imgUrl.includes('gtimg.cn');
    const isKuwo = imgUrl.includes('kuwo.cn');
    
    const headers = {};
    if (isNetease) {
      headers['Referer'] = 'https://music.163.com';
    } else if (isQQ) {
      headers['Referer'] = 'https://y.qq.com/';
    } else if (isKuwo) {
      headers['Referer'] = 'http://www.kuwo.cn/';
    }
    
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

    const response = await fetch(imgUrl, { headers });
    
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const resHeaders = new Headers(response.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Cache-Control', 'public, max-age=86400');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
