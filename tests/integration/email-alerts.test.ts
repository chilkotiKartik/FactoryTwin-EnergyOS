import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { alerts } from "@/db/schema";
import { MAX_RECIPIENTS, mailConfig, parseRecipients } from "@/server/mail";
import { deliverAlert, raiseAlert, setAlertEmails } from "@/server/services/alerts";
import { freshDb, IDS } from "../helpers/db";

/** A minimal SMTP server that records each message it receives. */
function smtpSink() {
  const messages: { from: string; to: string[]; data: string }[] = [];
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    let cur = { from: "", to: [] as string[], data: "" };
    sock.write("220 sink ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(cur);
            cur = { from: "", to: [], data: "" };
            sock.write("250 OK queued\r\n");
          } else cur.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-sink\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") {
          cur.from = line.slice(10).replace(/[<>]/g, "").split(" ")[0];
          sock.write("250 OK\r\n");
        } else if (cmd === "RCPT") {
          cur.to.push(line.slice(8).replace(/[<>]/g, ""));
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 OK\r\n");
      }
    });
  });
  return { server, messages };
}

let t: Awaited<ReturnType<typeof freshDb>>;
const sink = smtpSink();
const saved = { ...process.env };

beforeAll(async () => {
  t = await freshDb();
  await new Promise<void>((r) => sink.server.listen(0, "127.0.0.1", r));
  const port = (sink.server.address() as net.AddressInfo).port;
  process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
  process.env.SMTP_ALLOW_INSECURE = "true";
  process.env.ALERT_EMAIL_FROM = "EnergyOS <alerts@energyos.test>";
  process.env.APP_URL = "https://energyos.test/";
});
afterAll(async () => {
  process.env = saved;
  sink.server.close();
  await t.cleanup();
});

describe("recipient list", () => {
  it("splits, trims, lower-cases and removes duplicates", () => {
    expect(parseRecipients(" A@Plant.in, b@plant.in; a@plant.in ")).toEqual(["a@plant.in", "b@plant.in"]);
  });
  it("refuses bad addresses, header injection and too many recipients", () => {
    expect(() => parseRecipients("not-an-email")).toThrow(/not an email/);
    expect(() => parseRecipients("a@b.in\r\nBcc: x@y.in")).toThrow();
    expect(() => parseRecipients(Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@p.in`).join(","))).toThrow(/At most/);
  });
  it("email is off without SMTP_URL", () => {
    expect(mailConfig({})).toBeNull();
    expect(mailConfig({ SMTP_URL: "smtps://u:p@smtp.example.com:465", APP_URL: "https://x.in/" })).toMatchObject({ appUrl: "https://x.in", insecure: false });
  });
});

describe("email alerts", () => {
  it("only an owner can set recipients, and the change is validated", async () => {
    const sup = await t.actor(IDS.supervisorA);
    await expect(setAlertEmails(t.db, sup, "x@plant.in")).rejects.toThrow();
    const owner = await t.actor(IDS.ownerA);
    await expect(setAlertEmails(t.db, owner, "nope")).rejects.toThrow(/not an email/);
    expect((await setAlertEmails(t.db, owner, "Supervisor@Plant.in, owner@plant.in")).recipients).toEqual(["supervisor@plant.in", "owner@plant.in"]);
  });

  it("delivers an alert by email with a link, and records it on the alert", async () => {
    const owner = await t.actor(IDS.ownerA);
    const id = (await raiseAlert(t.db, owner.factory, { kind: "TEST", key: "email-test-1", title: "Heat H07 used 18% more energy", body: "Expected 340 kWh, measured 401 kWh.", href: "/heats/h07" }))!;
    await deliverAlert(t.db, id);
    const row = (await t.db.select().from(alerts).where(eq(alerts.id, id)))[0];
    expect(row.emailError).toBeNull();
    expect(row.emailedAt).not.toBeNull();
    const m = sink.messages.at(-1)!;
    expect(m.to.sort()).toEqual(["owner@plant.in", "supervisor@plant.in"]);
    expect(m.from).toBe("alerts@energyos.test");
    // The subject is MIME-encoded (it carries a non-ASCII "·"); the body is quoted-printable.
    expect(m.data).toMatch(/Subject: =\?UTF-8\?Q\?=5Bdemo=5D_Heat_H07_used_18=25/);
    const body = m.data.replace(/=\n/g, "");
    expect(body).toContain("https://energyos.test/heats/h07");
    expect(body).toContain("Advisory only");
  });

  it("records a failure when the mail server is unreachable, without throwing", async () => {
    process.env.SMTP_URL = "smtp://127.0.0.1:1";
    const owner = await t.actor(IDS.ownerA);
    const id = (await raiseAlert(t.db, owner.factory, { kind: "TEST", key: "email-test-2", title: "t", body: "b" }))!;
    await deliverAlert(t.db, id);
    const row = (await t.db.select().from(alerts).where(eq(alerts.id, id)))[0];
    expect(row.emailedAt).toBeNull();
    expect(row.emailError).toMatch(/ECONNREFUSED|connect/i);
  });
});
