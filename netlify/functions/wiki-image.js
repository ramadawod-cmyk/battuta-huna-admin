const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'BattutaHuna/1.0 (https://battutahuna.com)' },
      timeout: 8000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data) return reject(new Error('Empty response'));
        const first = data.trimStart()[0];
        if (first !== '{' && first !== '[') {
          return reject(new Error('Non-JSON response: ' + data.slice(0, 80)));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function httpsGetBinary(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'BattutaHuna/1.0 (https://battutahuna.com)',
        'Referer': 'https://en.wikipedia.org/'
      },
      timeout: 25000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetBinary(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'image/jpeg'
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*'
  };

  // ── Mode: proxy image bytes ──────────────────────────────────────────────
  if (params.img) {
    try {
      const decoded = decodeURIComponent(params.img);
      const { buffer, contentType } = await httpsGetBinary(decoded);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        },
        body: buffer.toString('base64'),
        isBase64Encoded: true
      };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── Mode: search Wikimedia Commons for multiple images ───────────────────
  if (params.search) {
    try {
      const query = encodeURIComponent(params.search);
      // Search Commons for images matching the place name
      const commonsUrl = 'https://commons.wikimedia.org/w/api.php?action=query' +
        '&generator=search&gsrnamespace=6&gsrsearch=' + query +
        '&gsrlimit=10&prop=imageinfo&iiprop=url|size|mime|extmetadata|timestamp' +
        '&iiurlwidth=800&format=json&origin=*';

      const data = await httpsGet(commonsUrl);
      const pages = data?.query?.pages || {};

      // Filter to only jpg/jpeg/png images, exclude icons/flags/maps/logos
      const EXCLUDE = ['flag', 'logo', 'icon', 'map', 'coat', 'seal', 'banner', 'symbol', 'sign'];
      const seenBase = new Set();
      const images = Object.values(pages)
        .filter(p => {
          const url = p.imageinfo?.[0]?.url || '';
          const mime = p.imageinfo?.[0]?.mime || '';
          const title = (p.title || '').toLowerCase();
          const isPhoto = mime === 'image/jpeg' || mime === 'image/png';
          const isExcluded = EXCLUDE.some(e => title.includes(e));
          const isLargeEnough = (p.imageinfo?.[0]?.width || 0) >= 400;
          return isPhoto && !isExcluded && isLargeEnough;
        })
        .filter(p => {
          // Deduplicate by dimensions — same width+height = same photo
          const w = p.imageinfo?.[0]?.width;
          const h = p.imageinfo?.[0]?.height;
          const key = `${w}x${h}`;
          if (seenBase.has(key)) return false;
          seenBase.add(key);
          return true;
        })
        .slice(0, 5)
        .map(p => {
          const info = p.imageinfo[0];
          // Use the API-provided thumbnail URL (800px) — avoids encoding issues
          const rawUrl = info.url.split('?')[0];
          const thumbUrl = info.thumburl || rawUrl; // thumburl comes from iiurlwidth=800
          const src = thumbUrl.split('?')[0]; // strip any params
          const proxied = '/.netlify/functions/wiki-image?img=' + encodeURIComponent(src);
          const artist = info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '') || '';
          const license = info.extmetadata?.LicenseShortName?.value || '';
          return {
            url: proxied,
            raw: src,
            width: info.width,
            height: info.height,
            attribution: [artist, license].filter(Boolean).join(' · ')
          };
        });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ images, count: images.length, query: params.search })
      };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── Mode: single title → Wikipedia thumbnail ────────────────────────────
  if (!params.title) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing title or search' }) };
  }

  try {
    const title = params.title;
    const wikiUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' +
      encodeURIComponent(title);

    const data = await httpsGet(wikiUrl);

    if (data.thumbnail && data.thumbnail.source) {
      const src = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
      const cleanSrc = encodeURIComponent(decodeURIComponent(src));
      const proxied = '/.netlify/functions/wiki-image?img=' + cleanSrc;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: proxied, title: data.title })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'No thumbnail', page: data.title || title })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
