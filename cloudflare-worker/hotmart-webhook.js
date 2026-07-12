// Cloudflare Worker — Hotmart webhook → Supabase Auth
// Env vars required: SUPABASE_URL, SUPABASE_SECRET_KEY

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== 'POST') {
        return new Response('OK', { status: 200 });
      }

      let payload;
      try { payload = await request.json(); }
      catch { return new Response('invalid json', { status: 400 }); }

      // Hotmart connectivity test
      if (payload.hottok !== undefined && !payload.event) {
        return new Response('OK', { status: 200 });
      }

      const validEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_CONFIRMED'];
      if (!validEvents.includes(payload.event)) {
        return new Response('ignored', { status: 200 });
      }

      const email = payload.data?.buyer?.email;
      if (!email) return new Response('no email', { status: 400 });

      // Create user in Supabase (or update existing)
      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`
        },
        body: JSON.stringify({ email: email, email_confirm: true })
      });

      // Send password recovery email (sets password for new users, resets for existing)
      await fetch(`${env.SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SECRET_KEY
        },
        body: JSON.stringify({
          email: email,
          redirect_to: 'https://prato-certo.pages.dev/login.html',
          gotrue_meta_security: {}
        })
      });

      return new Response('ok', { status: 200 });

    } catch (err) {
      return new Response('error: ' + err.message, { status: 500 });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
