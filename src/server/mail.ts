/**
 * Outbound email for alerts, over SMTP. Configured by the server operator, not per factory:
 *
 *   SMTP_URL          smtps://user:pass@smtp.example.com:465   (implicit TLS)
 *                     smtp://user:pass@smtp.example.com:587    (STARTTLS, required)
 *   ALERT_EMAIL_FROM  "EnergyOS <alerts@example.com>"
 *   APP_URL           https://factorytwin-energyos.onrender.com   (for links in the email)
 *
 * Without SMTP_URL, email is off and the settings screen says so. Plain smtp:// without
 * STARTTLS is allowed only for a local relay (SMTP_ALLOW_INSECURE=true), e.g. in tests.
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface MailConfig {
  url: string;
  from: string;
  appUrl: string | null;
  insecure: boolean;
}

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const url = env.SMTP_URL?.trim();
  if (!url) return null;
  return {
    url,
    from: env.ALERT_EMAIL_FROM?.trim() || "EnergyOS <alerts@localhost>",
    appUrl: env.APP_URL?.trim().replace(/\/+$/, "") || null,
    insecure: env.SMTP_ALLOW_INSECURE === "true",
  };
}

export const mailEnabled = () => mailConfig() !== null;

let cached: { url: string; t: Transporter } | null = null;
function transporter(cfg: MailConfig): Transporter {
  if (cached?.url === cfg.url) return cached.t;
  const u = new URL(cfg.url);
  const secure = u.protocol === "smtps:";
  const t = nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure && !cfg.insecure,
    ignoreTLS: cfg.insecure,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  cached = { url: cfg.url, t };
  return t;
}

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const MAX_RECIPIENTS = 5;

/** Split, trim, validate and de-duplicate a recipient list. Throws a readable message. */
export function parseRecipients(raw: string): string[] {
  const list = [...new Set(raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const bad = list.find((e) => !EMAIL.test(e) || e.length > 254);
  if (bad) throw new Error(`"${bad}" is not an email address.`);
  if (list.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} addresses.`);
  return list;
}

export interface AlertMail {
  to: string[];
  subject: string;
  text: string;
  path: string | null;
}

export async function sendAlertMail(m: AlertMail, cfg = mailConfig()): Promise<void> {
  if (!cfg) throw new Error("Email is not configured on this server.");
  const link = m.path ? (cfg.appUrl ? `${cfg.appUrl}${m.path}` : m.path) : null;
  const text = `${m.text}\n\n${link ? `Open: ${link}\n\n` : ""}— EnergyOS. Advisory only: no command is sent to plant equipment.`;
  await transporter(cfg).sendMail({
    from: cfg.from,
    to: m.to,
    subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    text,
  });
}
