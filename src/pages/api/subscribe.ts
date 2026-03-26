import type { APIRoute } from 'astro';
import { FROM_EMAIL, SITE_TITLE } from '@/consts';

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

  try {
    await env.DB.prepare(
      'INSERT INTO subscribers (email) VALUES (?)'
    ).bind(email).run();
  } catch (err: unknown) {
    // D1 UNIQUE constraint violation → already subscribed
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return json({ message: "You're already on the list!" }, 200);
    }
    console.error('D1 error:', err);
    return json({ message: 'Something went wrong. Please try again.' }, 500);
  }

  // Send welcome email via Resend
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: `Welcome to ${SITE_TITLE}`,
        html: `<p>You're in! I'll send you a note when there's something new to read.</p>
               <p>— Brett</p>
               <hr/>
               <p style="color:#78716c;font-size:12px;">
                 You subscribed at flippinflops.com.
                 Reply to this email to unsubscribe.
               </p>`,
      }),
    });
  } catch (err) {
    // Non-fatal — subscriber is saved, welcome email failed
    console.error('Resend error:', err);
  }

  return json({ message: "You're subscribed! Check your inbox for a welcome note." }, 201);
};

function json(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
