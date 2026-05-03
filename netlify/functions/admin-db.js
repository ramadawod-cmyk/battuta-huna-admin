const https = require('https');

function request(method, path, body, prefer) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.SUPABASE_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': prefer ? `return=representation,${prefer}` : 'return=representation'
      }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { action, data } = JSON.parse(event.body || '{}');

  try {
    // Get all sites
    if (action === 'getSites') {
      const res = await request('GET', '/rest/v1/sites?select=id,name,city_id,category,description,long_description,image_url,review_status&order=city_id,name');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // Upsert city
    if (action === 'saveCity') {
      const { id, name } = data;
      const res = await request('POST', '/rest/v1/cities', { id, name, wiki: name }, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // Batch upsert sites
    if (action === 'upsertSites') {
      const { sites } = data;
      const res = await request('POST', '/rest/v1/sites', sites, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify({ count: sites.length }) };
    }

    // Update image URL
    if (action === 'saveImageUrl') {
      const { name, cityId, imageUrl } = data;
      const res = await request('PATCH', `/rest/v1/sites?name=eq.${encodeURIComponent(name)}&city_id=eq.${cityId}`, { image_url: imageUrl });
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // Update long description
    if (action === 'saveLongDesc') {
      const { name, cityId, longDesc } = data;
      const res = await request('PATCH', `/rest/v1/sites?name=eq.${encodeURIComponent(name)}&city_id=eq.${cityId}`, { long_description: longDesc, review_status: 'human_reviewed' });
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
