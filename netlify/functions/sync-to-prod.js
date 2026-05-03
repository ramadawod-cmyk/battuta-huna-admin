const https = require('https');

function request(baseUrl, key, method, path, body, prefer) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
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

  const stgUrl = process.env.SUPABASE_URL;
  const stgKey = process.env.SUPABASE_ANON_KEY;
  const prodUrl = process.env.PROD_SUPABASE_URL;
  const prodKey = process.env.PROD_SUPABASE_ANON_KEY;

  if (!prodUrl || !prodKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Production Supabase credentials not configured' }) };
  }

  try {
    const { table } = JSON.parse(event.body || '{}');

    if (table === 'sites') {
      // Read all sites from staging
      const stgSites = await request(stgUrl, stgKey, 'GET', '/rest/v1/sites?select=*&order=city_id,name');
      const sites = stgSites.body || [];

      // Write to production in batches of 20
      let synced = 0;
      for (let i = 0; i < sites.length; i += 20) {
        const batch = sites.slice(i, i + 20);
        await request(prodUrl, prodKey, 'POST', '/rest/v1/sites', batch, 'resolution=merge-duplicates');
        synced += batch.length;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ synced, total: sites.length, table: 'sites' }) };
    }

    if (table === 'cities') {
      const stgCities = await request(stgUrl, stgKey, 'GET', '/rest/v1/cities?select=*&order=name');
      const cities = stgCities.body || [];
      await request(prodUrl, prodKey, 'POST', '/rest/v1/cities', cities, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify({ synced: cities.length, table: 'cities' }) };
    }

    if (table === 'countries') {
      const stgCountries = await request(stgUrl, stgKey, 'GET', '/rest/v1/countries?select=*&order=name');
      const countries = stgCountries.body || [];
      await request(prodUrl, prodKey, 'POST', '/rest/v1/countries', countries, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify({ synced: countries.length, table: 'countries' }) };
    }

    if (table === 'all') {
      // Sync countries → cities → sites in order (respect FK constraints)
      const countries = (await request(stgUrl, stgKey, 'GET', '/rest/v1/countries?select=*')).body || [];
      const cities = (await request(stgUrl, stgKey, 'GET', '/rest/v1/cities?select=*')).body || [];
      const sites = (await request(stgUrl, stgKey, 'GET', '/rest/v1/sites?select=*')).body || [];

      if (countries.length) await request(prodUrl, prodKey, 'POST', '/rest/v1/countries', countries, 'resolution=merge-duplicates');
      if (cities.length) await request(prodUrl, prodKey, 'POST', '/rest/v1/cities', cities, 'resolution=merge-duplicates');

      let sitesSynced = 0;
      for (let i = 0; i < sites.length; i += 20) {
        const batch = sites.slice(i, i + 20);
        await request(prodUrl, prodKey, 'POST', '/rest/v1/sites', batch, 'resolution=merge-duplicates');
        sitesSynced += batch.length;
      }

      return { statusCode: 200, headers, body: JSON.stringify({
        countries: countries.length, cities: cities.length, sites: sitesSynced
      })};
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown table' }) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
