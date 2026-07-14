// Cloudflare Worker — Hotmart webhook → Supabase Auth + Meta Conversions API
// Env vars required: SUPABASE_SECRET_KEY, PREMIUM_ID, CAPI_TOKEN
const SUPABASE_URL = 'https://achtuwinkhhqiovzpoth.supabase.co';
const PIXEL_ID = '840452762252112';

export default {
  async fetch(request, env) {
    try {
      if (request.method !== 'POST') {
        return new Response('OK', { status: 200 });
      }

      let body;
      try { body = await request.json(); }
      catch { return new Response('Invalid JSON', { status: 400 }); }

      const event = body.event;
      if (event !== 'PURCHASE_COMPLETE' && event !== 'PURCHASE_APPROVED') {
        return new Response(JSON.stringify({ ignored: true, event }), { status: 200 });
      }

      const email = body.data?.buyer?.email;
      const nome = body.data?.buyer?.name || '';
      const prodId = String(body.data?.product?.id || '');

      if (!email) return new Response('No email', { status: 400 });

      const plano = (prodId === String(env.PREMIUM_ID)) ? 'premium' : 'base';

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'apikey': env.SUPABASE_SECRET_KEY
      };

      // 1. criar utilizador (auto-confirmado)
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          email_confirm: true,
          user_metadata: { plano, nome }
        })
      });
      const createText = await createRes.text();
      const createJson = JSON.parse(createText);

      if (!createRes.ok) {
        // utilizador já existe — atualiza plano
        const listRes = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
          { headers }
        );
        const listJson = await listRes.json();
        const userId = listJson.users?.[0]?.id;

        if (userId) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ user_metadata: { plano, nome } })
          });
          await sendPurchaseToMeta(body, plano, env).catch(() => {});
          await relayToServerGTM(body).catch(() => {});
          return new Response(JSON.stringify({ ok: true, action: 'updated', plano, email }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, createStatus: createRes.status, createBody: createText }), { status: 200 });
      }

      // 2. enviar email de recuperação de senha (serve como "definir senha")
      await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_SECRET_KEY },
        body: JSON.stringify({ email })
      });

      // 3. reportar a venda confirmada ao Meta Conversions API
      await sendPurchaseToMeta(body, plano, env).catch(() => {});
      await relayToServerGTM(body).catch(() => {});

      return new Response(JSON.stringify({ ok: true, action: 'invited', plano, email }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendPurchaseToMeta(body, plano, env) {
  if (!env.CAPI_TOKEN) return;

  const buyer = body.data?.buyer || {};
  const purchase = body.data?.purchase || {};
  const transaction = purchase.transaction || ('hm_' + Date.now());

  const userData = { em: [await sha256Hex(buyer.email)] };
  const phone = buyer.checkout_phone || buyer.phone;
  if (phone) userData.ph = [await sha256Hex(String(phone).replace(/\D/g, ''))];
  if (buyer.name) {
    const parts = buyer.name.trim().split(/\s+/);
    userData.fn = [await sha256Hex(parts[0])];
    if (parts.length > 1) userData.ln = [await sha256Hex(parts[parts.length - 1])];
  }

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_id: 'purchase_' + transaction,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        currency: purchase.price?.currency_value || 'EUR',
        value: purchase.price?.value ?? 0,
        transaction_id: transaction,
        plano
      }
    }]
  };

  await fetch(`https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${env.CAPI_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function relayToServerGTM(body) {
  await fetch('https://api.prato-certo.com/lead/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
