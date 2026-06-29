import type { APIRoute } from 'astro';
import { FROM_EMAIL, RESEND_AUDIENCE_ID, SITE_TITLE } from '@/consts';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const { env } = locals.runtime;
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/confirmed?status=invalid');
  }

  const row = await env.DB.prepare(
    'SELECT id, email, confirmed FROM subscribers WHERE token = ?'
  ).bind(token).first<{ id: number; email: string; confirmed: number }>();

  if (!row) {
    return redirect('/confirmed?status=invalid');
  }

  if (row.confirmed) {
    return redirect('/confirmed?status=already');
  }

  // Mark confirmed and clear token
  await env.DB.prepare(
    'UPDATE subscribers SET confirmed = 1, token = NULL WHERE id = ?'
  ).bind(row.id).run();

  // Add to Resend audience
  try {
    await fetch(`https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: row.email,
        unsubscribed: false,
      }),
    });
  } catch (err) {
    console.error('Resend audience error:', err);
  }

  // Send welcome email now that they've confirmed
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [row.email],
        subject: `Welcome to ${SITE_TITLE}`,
        html: `
          <p>You're in! I'll send you a note when there's something new to read.</p>
          <p>— Brett</p>
          <hr/>
          <p style="color:#78716c;font-size:12px;">
            Reply to this email to unsubscribe.
          </p>
        `,
      }),
    });
  } catch (err) {
    console.error('Resend welcome error:', err);
  }

  return redirect('/confirmed?status=ok');
};

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
