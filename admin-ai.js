const https = require('https');

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { system, user } = JSON.parse(event.body || '{}');
  if (!system || !user) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing system or user prompt' }) };

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: user }],
      system
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 55000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || '';
          resolve({ statusCode: 200, headers, body: JSON.stringify({ text }) });
        } catch(e) {
          resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) });
        }
      });
    });
    req.on('error', e => resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 504, headers, body: JSON.stringify({ error: 'Timeout' }) }); });
    req.write(payload);
    req.end();
  });
};
