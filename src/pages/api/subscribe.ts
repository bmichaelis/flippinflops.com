import type { APIRoute } from 'astro';
import { FROM_EMAIL, SITE_TITLE, SITE_URL } from '@/consts';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;

  let email: string;
  try {
    const body = await request.json() as { email?: string };
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    return json({ message: 'Invalid request.' }, 400);
  }

  if (!email || !/.+@.+\..+/.test(email)) {
    return json({ message: 'Please enter a valid email address.' }, 400);
  }

  const token = crypto.randomUUID();

  try {
    await env.DB.prepare(
      'INSERT INTO subscribers (email, token) VALUES (?, ?)'
    ).bind(email, token).run();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      const row = await env.DB.prepare(
        'SELECT confirmed FROM subscribers WHERE email = ?'
      ).bind(email).first<{ confirmed: number }>();

      if (row?.confirmed) {
        return json({ message: "You're already subscribed!" }, 200);
      }
      return json({ message: "Check your inbox — a confirmation email is on its way." }, 200);
    }
    console.error('D1 error:', err);
    return json({ message: 'Something went wrong. Please try again.' }, 500);
  }

  const confirmUrl = `${SITE_URL}/api/confirm?token=${token}`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: `Confirm your subscription to ${SITE_TITLE}`,
        html: `
          <p>Thanks for signing up! Click the link below to confirm your subscription:</p>
          <p><a href="${confirmUrl}">${confirmUrl}</a></p>
          <p>If you didn't request this, you can safely ignore this email.</p>
          <hr/>
          <p style="color:#78716c;font-size:12px;">You're receiving this because someone entered this address at flippinflops.com.</p>
        `,
      }),
    });
    if (!resendRes.ok) {
      console.error('Resend error:', resendRes.status, await resendRes.text());
    }
  } catch (err) {
    console.error('Resend error:', err);
  }

  return json({ message: "Check your inbox — click the confirmation link to finish subscribing." }, 201);
};

function json(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
