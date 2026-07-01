const PIXEL_ID = '840452762252112';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.prato-certo.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { event_name, event_id, event_source_url, user_data, custom_data } = req.body || {};
  if (!event_name) return res.status(400).json({ ok: false, error: 'event_name required' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';

  const payload = {
    data: [{
      event_name,
      event_id: event_id || ('sv_' + Date.now()),
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: event_source_url || 'https://www.prato-certo.com/',
      action_source: 'website',
      user_data: {
        client_ip_address: ip,
        client_user_agent: ua,
        ...(user_data || {})
      },
      ...(custom_data ? { custom_data } : {})
    }]
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${process.env.CAPI_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    const data = await r.json();
    return res.status(200).json({ ok: true, received: data.events_received });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
};
