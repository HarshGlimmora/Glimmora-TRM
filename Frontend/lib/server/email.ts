/**
 * Email transport for Glimmora TRM.
 *
 * Resolves the provider from EMAIL_PROVIDER (smtp | resend), falls back
 * across providers, and falls back to console-logging the OTP in dev so
 * the flow still works if email infrastructure is misconfigured.
 *
 * Server-only. Never imported from a client component.
 */
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

declare global {
  // eslint-disable-next-line no-var
  var __glmra_smtp: Transporter | undefined;
}

function smtpTransporter(): Transporter | null {
  if (globalThis.__glmra_smtp) return globalThis.__glmra_smtp;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  if (!host || !user || !pass) return null;

  const t = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    requireTLS: port === 587,
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });
  globalThis.__glmra_smtp = t;
  return t;
}

export interface OtpEmailArgs {
  to: string;
  code: string;
  channel: "email" | "mobile";
  /** When channel=mobile, the actual phone number for the email body */
  forwardForMobile?: string;
  ttlMinutes: number;
}

const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Glimmora TRM";
const FROM_EMAIL = process.env.EMAIL_FROM ?? "noreply@glimmora.local";

function buildSubject(code: string, args: OtpEmailArgs): string {
  return args.channel === "mobile"
    ? `Glimmora TRM verification code ${code} (for +91 ${args.forwardForMobile})`
    : `Glimmora TRM verification code ${code}`;
}

function buildText(code: string, args: OtpEmailArgs): string {
  const target =
    args.channel === "mobile"
      ? `mobile +91 ${args.forwardForMobile}`
      : "this email";
  return `Your Glimmora TRM verification code is ${code}.

This code expires in ${args.ttlMinutes} minutes and is for ${target}.
If you didn't request it, you can safely ignore this email.

— Glimmora TRM
`;
}

function buildHtml(code: string, args: OtpEmailArgs): string {
  const target =
    args.channel === "mobile"
      ? `mobile <strong>+91 ${args.forwardForMobile}</strong>`
      : `this email address`;
  // A deliberately conservative, table-based template that renders
  // consistently across email clients (Gmail, Outlook, Apple Mail).
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Glimmora TRM verification</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f5f9;font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#101a2b;-webkit-font-smoothing:antialiased;">
    <span style="display:none!important;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;">
      Your Glimmora TRM verification code is ${code}. It expires in ${args.ttlMinutes} minutes.
    </span>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e6e9ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 16px 32px;background:linear-gradient(180deg,#0e1c34,#1a2c4e);color:#ffffff;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <div style="display:inline-flex;align-items:center;gap:10px;">
                        <span style="display:inline-block;width:28px;height:28px;border-radius:6px;background:#ffffff;color:#0e1c34;text-align:center;line-height:28px;font-weight:700;font-size:14px;letter-spacing:-0.02em;">G</span>
                        <span style="font-weight:600;letter-spacing:-0.01em;font-size:15px;">Glimmora <span style="border:1px solid rgba(255,255,255,0.3);padding:1px 5px;border-radius:3px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;margin-left:4px;">TRM</span></span>
                      </div>
                    </td>
                    <td align="right" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.65);">
                      Secure verification
                    </td>
                  </tr>
                </table>
                <h1 style="margin:18px 0 6px 0;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:30px;line-height:1.1;color:#ffffff;">
                  Verify it&rsquo;s you.
                </h1>
                <p style="margin:0;color:rgba(255,255,255,0.78);font-size:14px;line-height:1.5;">
                  Use the code below to continue signing in to your Glimmora TRM account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 12px 32px;">
                <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;">Your verification code</p>
                <div style="display:inline-block;padding:18px 22px;background:#f6f7fa;border:1px solid #e6e9ef;border-radius:10px;">
                  <span style="font-family:'IBM Plex Mono','Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;letter-spacing:0.32em;font-weight:600;color:#101a2b;">
                    ${code}
                  </span>
                </div>
                <p style="margin:18px 0 0 0;font-size:14px;line-height:1.55;color:#3b475a;">
                  This code expires in <strong>${args.ttlMinutes} minutes</strong> and was requested for ${target}.
                  If you didn&rsquo;t request it, you can ignore this email — no further action is needed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafc;border:1px solid #e6e9ef;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#3b475a;">
                      <strong style="color:#101a2b;">Security notes</strong><br/>
                      &bull; Glimmora will never ask for this code over the phone or chat.<br/>
                      &bull; The code is single-use and locks after 5 wrong attempts for 60 seconds.<br/>
                      &bull; Issued for the device and session that initiated this request only.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 32px 22px 32px;border-top:1px solid #eef0f4;background:#fbfbfd;">
                <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9aa3b2;">
                  Glimmora TRM &middot; Sovereign Tax Resource Management &middot; India
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface SendResult {
  ok: boolean;
  via: "smtp" | "resend" | "console";
  messageId?: string;
  error?: string;
}

async function sendViaSmtp(args: OtpEmailArgs): Promise<SendResult> {
  const t = smtpTransporter();
  if (!t) return { ok: false, via: "smtp", error: "SMTP not configured" };
  try {
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: args.to,
      subject: buildSubject(args.code, args),
      text: buildText(args.code, args),
      html: buildHtml(args.code, args),
      headers: {
        "X-Entity-Ref-ID": `glmra-otp-${args.code}`,
        "Auto-Submitted": "auto-generated",
      },
    });
    return { ok: true, via: "smtp", messageId: info.messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown SMTP error";
    return { ok: false, via: "smtp", error: msg };
  }
}

async function sendViaResend(args: OtpEmailArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, via: "resend", error: "Resend not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [args.to],
        subject: buildSubject(args.code, args),
        text: buildText(args.code, args),
        html: buildHtml(args.code, args),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, via: "resend", error: `Resend ${res.status}: ${body}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, via: "resend", messageId: json.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown Resend error";
    return { ok: false, via: "resend", error: msg };
  }
}

export async function sendOtpEmail(args: OtpEmailArgs): Promise<SendResult> {
  const provider = (process.env.EMAIL_PROVIDER ?? "smtp").toLowerCase();

  let result: SendResult;
  if (provider === "resend") {
    result = await sendViaResend(args);
    if (!result.ok) result = await sendViaSmtp(args);
  } else {
    result = await sendViaSmtp(args);
    if (!result.ok) result = await sendViaResend(args);
  }

  // Dev-mode visibility: even on successful delivery we echo the OTP to the
  // server console so tests and local dev don't have to round-trip through
  // a real mailbox. This branch is guarded by NODE_ENV and is gone in prod.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[email.dev] OTP for ${args.to}: ${args.code} (via ${result.via})`);
  }

  if (!result.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[email] Could not deliver to ${args.to} (${result.via}: ${result.error}).`,
      );
      return { ok: true, via: "console" };
    }
  }
  return result;
}
