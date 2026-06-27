// Cloudflare Worker — Hotmart webhook → Supabase Auth invite
// Env vars required: SUPABASE_URL, SUPABASE_SECRET_KEY

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    let payload;
    try { payload = await request.json(); }
    catch { return new Response('invalid json', { status: 400 }); }

    // Hotmart connectivity test (hottok field)
    if (payload.hottok !== undefined && !payload.event) {
      return new Response('OK', { status: 200 });
    }

    const validEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_CONFIRMED'];
    if (!validEvents.includes(payload.event)) {
      return new Response('ignored', { status: 200 });
    }

    const email = payload.data?.buyer?.email;
    if (!email) return new Response('no email', { status: 400 });

    // Invite user in Supabase (creates account + sends invite email with set-password link)
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`
      },
      body: JSON.stringify({
        email: email,
        redirect_to: 'https://prato-certo.pages.dev/login.html'
      })
    });

    const result = await res.json();

    // User already exists → send password reset instead
    if (!res.ok) {
      const resetRes = await fetch(`${env.SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SECRET_KEY
        },
        body: JSON.stringify({ email: email })
      });
      return new Response('reset sent', { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, email }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
