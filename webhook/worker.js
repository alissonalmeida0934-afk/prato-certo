const SUPABASE_URL = 'https://achtuwinkhhqiovzpoth.supabase.co';

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
      const nome  = body.data?.buyer?.name || '';
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

      // Order bump: encontra utilizador e adiciona intestino:true sem alterar plano
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
          return new Response(JSON.stringify({ ok: true, action: 'bump_intestino', email }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, reason: 'user_not_found_for_bump', email }), { status: 200 });
      }

      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, email_confirm: true, user_metadata: { plano, nome } })
      });

      const createText = await createRes.text();

      if (!createRes.ok) {
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
          return new Response(JSON.stringify({ ok: true, action: 'updated', plano, email }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, createStatus: createRes.status, createBody: createText }), { status: 200 });
      }

      await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_SECRET_KEY },
        body: JSON.stringify({ email })
      });

      return new Response(JSON.stringify({ ok: true, action: 'invited', plano, email }), { status: 200 });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 200 });
    }
  }
};
