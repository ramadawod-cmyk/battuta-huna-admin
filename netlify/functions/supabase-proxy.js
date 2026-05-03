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
    'Access-Control-Allow-Headers': 'Content-Type, x-device-id'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    const { action, data } = JSON.parse(event.body || '{}');
    const deviceId = event.headers['x-device-id'] || 'anonymous';

    // ── GET SITE ─────────────────────────────────────
    if (action === 'getSite') {
      const { siteId, name, cityId } = data;
      let res;
      if (name && cityId) {
        // Look up by name + city — more reliable than ID
        res = await request('GET', `/rest/v1/sites?name=eq.${encodeURIComponent(name)}&city_id=eq.${cityId}&select=*`);
      } else {
        res = await request('GET', `/rest/v1/sites?id=eq.${siteId}&select=*`);
      }
      const rows = res.body;
      return { statusCode: 200, headers, body: JSON.stringify(rows?.[0] || null) };
    }

    // ── SAVE LONG DESCRIPTION ────────────────────────
    if (action === 'saveLongDescription') {
      const { siteId, name, cityId, longDescription } = data;
      let res;
      if (name && cityId) {
        res = await request('PATCH', `/rest/v1/sites?name=eq.${encodeURIComponent(name)}&city_id=eq.${cityId}`, { long_description: longDescription, review_status: 'ai_complete' });
      } else {
        res = await request('PATCH', `/rest/v1/sites?id=eq.${siteId}`, { long_description: longDescription, review_status: 'ai_complete' });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // ── SAVE IMAGE URL ───────────────────────────────
    if (action === 'saveImageUrl') {
      const { name, cityId, imageUrl } = data;
      const res = await request('PATCH', `/rest/v1/sites?name=eq.${encodeURIComponent(name)}&city_id=eq.${cityId}`, { image_url: imageUrl, review_status: 'ai_complete' });
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // ── GET CITY HERO ────────────────────────────────
    if (action === 'getCityHero') {
      const { cityId } = data;
      const res = await request('GET', `/rest/v1/cities?id=eq.${cityId}&select=hero_image_url`);
      const rows = res.body;
      return { statusCode: 200, headers, body: JSON.stringify(rows?.[0] || null) };
    }

    // ── GET CITY TIPS ────────────────────────────────
    if (action === 'getCityTips') {
      const { cityId } = data;
      const res = await request('GET', `/rest/v1/cities?id=eq.${cityId}&select=tips`);
      const rows = res.body;
      return { statusCode: 200, headers, body: JSON.stringify(rows?.[0]?.tips || null) };
    }

    // ── SAVE CITY TIPS ───────────────────────────────
    if (action === 'saveCityTips') {
      const { cityId, tips } = data;
      const res = await request('PATCH', `/rest/v1/cities?id=eq.${cityId}`, { tips });
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // ── SAVE WEATHER TIP ─────────────────────────────
    if (action === 'saveWeatherTip') {
      const { tripId, weatherTip } = data;
      const res = await request('PATCH', `/rest/v1/trips?id=eq.${tripId}`, { weather_tip: weatherTip });
      return { statusCode: 200, headers, body: JSON.stringify({ saved: true }) };
    }

    // ── GET CITIES ───────────────────────────────────
    if (action === 'getCities') {
      const res = await request('GET', '/rest/v1/cities?select=*&order=name');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── GET SITES FOR CITY ───────────────────────────
    if (action === 'getSites') {
      const { cityId } = data;
      const res = await request('GET', `/rest/v1/sites?city_id=eq.${cityId}&select=*&order=name`);
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── UPSERT COUNTRY ───────────────────────────────
    if (action === 'upsertCountry') {
      const country = data.country;
      const res = await request('POST', '/rest/v1/countries', country, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── UPSERT CITY (AI generated) ───────────────────
    if (action === 'upsertCity') {
      const city = data.city;
      const res = await request('POST', '/rest/v1/cities', city, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── UPSERT SITE (AI generated) ───────────────────
    if (action === 'upsertSite') {
      const site = data.site;
      const res = await request('POST', '/rest/v1/sites', site, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── UPSERT SITES BATCH ───────────────────────────
    if (action === 'upsertSites') {
      const sites = data.sites;
      const res = await request('POST', '/rest/v1/sites', sites, 'resolution=merge-duplicates');
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── CREATE DRAFT TRIP ────────────────────────────
    if (action === 'createDraftTrip') {
      const trip = { ...data.trip, user_id: deviceId, status: 'planning' };
      const res = await request('POST', '/rest/v1/trips', trip);
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── UPDATE TRIP STATUS ───────────────────────────
    if (action === 'updateTripStatus') {
      const { tripId, status, days } = data;
      const patch = { status };
      if (days) patch.days = days;
      const res = await request('PATCH', `/rest/v1/trips?id=eq.${tripId}&user_id=eq.${deviceId}`, patch);
      return { statusCode: 200, headers, body: JSON.stringify({ updated: true }) };
    }

    // ── GET TRIPS ────────────────────────────────────
    if (action === 'getTrips') {
      const res = await request('GET', `/rest/v1/trips?user_id=eq.${deviceId}&select=*&order=created_at.desc`);
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── SAVE TRIP ────────────────────────────────────
    if (action === 'saveTrip') {
      const trip = { ...data.trip, user_id: deviceId };
      const res = await request('POST', '/rest/v1/trips', trip);
      return { statusCode: 200, headers, body: JSON.stringify(res.body) };
    }

    // ── DELETE TRIP ──────────────────────────────────
    if (action === 'deleteTrip') {
      const { tripId } = data;
      const res = await request('DELETE', `/rest/v1/trips?id=eq.${tripId}&user_id=eq.${deviceId}`);
      return { statusCode: 200, headers, body: JSON.stringify({ deleted: true }) };
    }

    // ── UPDATE CITY HERO IMAGE ───────────────────────
    if (action === 'updateCityHero') {
      const { cityId, heroImageUrl } = data;
      const res = await request('PATCH', `/rest/v1/cities?id=eq.${cityId}`, { hero_image_url: heroImageUrl });
      return { statusCode: 200, headers, body: JSON.stringify({ updated: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
