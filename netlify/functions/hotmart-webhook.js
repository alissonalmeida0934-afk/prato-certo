exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const validEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_CONFIRMED'];
  if (!validEvents.includes(payload.event)) {
    return { statusCode: 200, body: 'ignored' };
  }

  const buyer = payload.data?.buyer;
  const email = buyer?.email;
  if (!email) return { statusCode: 400, body: 'no email' };

  const siteUrl = process.env.SITE_URL || 'https://cool-lokum-0d01a0.netlify.app';

  // Generate random temp password (user will reset it via email)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let tempPass = '';
  for (let i = 0; i < 16; i++) tempPass += chars[Math.floor(Math.random() * chars.length)];

  // Step 1: Create account via public signup endpoint
  const signupRes = await fetch(`${siteUrl}/.netlify/identity/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: tempPass })
  });
  const signupBody = await signupRes.text();
  console.log('Signup:', signupRes.status, signupBody.slice(0, 100));

  // Step 2: Send password reset email (public endpoint, no JWT needed)
  const recoverRes = await fetch(`${siteUrl}/.netlify/identity/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const recoverBody = await recoverRes.text();
  console.log('Recover:', recoverRes.status, recoverBody.slice(0, 100));

  return { statusCode: 200, body: 'ok' };
};
