// Supabase Edge Function: send-2fa-email
// Deploy with: supabase functions deploy send-2fa-email
// Sends the 2FA code via Gmail SMTP (already configured for the project)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return new Response(JSON.stringify({ error: 'email et code requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Uses Gmail SMTP credentials stored as Supabase secrets
    // Set with: supabase secrets set GMAIL_USER=xxx GMAIL_APP_PASSWORD=xxx
    const GMAIL_USER = Deno.env.get('GMAIL_USER');
    const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');

    const client = new SmtpClient();
    await client.connectTLS({
      hostname: 'smtp.gmail.com',
      port: 465,
      username: GMAIL_USER,
      password: GMAIL_APP_PASSWORD,
    });

    await client.send({
      from: GMAIL_USER,
      to: email,
      subject: 'Votre code de vérification Yo',
      content: `Votre code de vérification est : ${code}\n\nCe code expire dans 10 minutes.\n\nSi vous n'avez pas demandé ce code, ignorez cet email.`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="color: #0d0d0d;">Code de vérification Yo</h2>
          <p style="color: #6b6b6b; font-size: 14px;">Utilisez ce code pour vous connecter :</p>
          <div style="background: #f7f7f8; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0d0d0d;">${code}</span>
          </div>
          <p style="color: #a0a0a0; font-size: 12px;">Ce code expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet email.</p>
        </div>
      `,
    });

    await client.close();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Note: import SmtpClient from denomailer or similar Deno SMTP library
// import { SmtpClient } from 'https://deno.land/x/denomailer/mod.ts';
