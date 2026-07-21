// Cloudflare Worker — Hotmart webhook → Supabase Auth + Meta Conversions API
// Env vars required: SUPABASE_SECRET_KEY, SUPABASE_ANON_KEY, PREMIUM_ID, CAPI_TOKEN, ADMIN_EMAIL
const SUPABASE_URL = 'https://achtuwinkhhqiovzpoth.supabase.co';
const PIXEL_ID = '840452762252112';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/admin/users') {
      return handleAdminUsers(request, env);
    }

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

      const BUMP_ID = '8112009'; // 7 Dias Sem Prisão de Ventre
      const isOrderBump = prodId === BUMP_ID;
      const plano = (prodId === String(env.PREMIUM_ID)) ? 'premium' : 'base';

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'apikey': env.SUPABASE_SECRET_KEY
      };

      // 0. order bump: encontra utilizador e adiciona intestino:true sem alterar plano
      if (isOrderBump) {
        const listRes = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
          { headers }
        );
        const listJson = await listRes.json();
        const userId = listJson.users?.[0]?.id;
        const existingMeta = listJson.users?.[0]?.user_metadata || {};
        if (userId) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ user_metadata: { ...existingMeta, intestino: true } })
          });
          await sendPurchaseToMeta(body, existingMeta.plano || 'base', env).catch(() => {});
          return new Response(JSON.stringify({ ok: true, action: 'bump_intestino', email }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, reason: 'user_not_found_for_bump', email }), { status: 200 });
      }

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

const PUBLISHABLE_KEY = 'sb_publishable_bu-Kz9vcPInHCxwUOqy7yw_8e_7GXgy';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type'
};

async function handleAdminUsers(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const adminEmail = env.ADMIN_EMAIL || 'alissonalmeida0934@gmail.com';
  const authHeader = request.headers.get('Authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!accessToken) {
    return json({ error: 'missing_token' }, 401);
  }

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': PUBLISHABLE_KEY }
  });
  if (!meRes.ok) return json({ error: 'invalid_token' }, 401);
  const me = await meRes.json();
  if ((me.email || '').toLowerCase() !== adminEmail.toLowerCase()) {
    return json({ error: 'forbidden' }, 403);
  }

  const secretHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
    'apikey': env.SUPABASE_SECRET_KEY
  };

  const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: secretHeaders });
  const usersJson = await usersRes.json();
  const users = usersJson.users || [];

  const activityRes = await fetch(
    `${SUPABASE_URL}/rest/v1/activity_log?select=user_id,event_type,meta,created_at&order=created_at.asc`,
    { headers: secretHeaders }
  );
  const activity = activityRes.ok ? await activityRes.json() : [];

  const byUser = {};
  for (const row of activity) {
    const b = (byUser[row.user_id] = byUser[row.user_id] || { loginDays: new Set(), lastLogin: null, recipeOpens: 0, lastRecipe: null });
    if (row.event_type === 'login') {
      b.loginDays.add(row.created_at.slice(0, 10));
      b.lastLogin = row.created_at;
    } else if (row.event_type === 'recipe_open') {
      b.recipeOpens += 1;
      b.lastRecipe = { nome: row.meta && row.meta.receita, categoria: row.meta && row.meta.categoria, em: row.created_at };
    }
  }

  const result = users.map(u => {
    const b = byUser[u.id] || { loginDays: new Set(), lastLogin: null, recipeOpens: 0, lastRecipe: null };
    return {
      email: u.email,
      plano: (u.user_metadata && u.user_metadata.plano) || 'base',
      criado_em: u.created_at,
      ultimo_login: b.lastLogin || u.last_sign_in_at || null,
      dias_logados: b.loginDays.size,
      receitas_abertas: b.recipeOpens,
      ultima_receita: b.lastRecipe
    };
  }).sort((a, b) => new Date(b.ultimo_login || 0) - new Date(a.ultimo_login || 0));

  return json(result, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}
