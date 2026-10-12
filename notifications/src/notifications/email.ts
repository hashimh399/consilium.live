import type { EmailConfig } from "../config.js";
import { DeliveryError, describeError } from "../delivery/errors.js";
import { deliver, type ProviderRequest } from "../delivery/transport.js";
import { maskEmail } from "../logger.js";
import { formatCoordinates, mapsLink, type Coordinates, type NotificationResult } from "../types.js";
import type { NotifyContext } from "./context.js";

export interface ManagerAlert {
  subject: string;
  text: string;
  html: string;
}

/** A sentiment below this reads as an unhappy customer worth escalating. */
const ESCALATION_THRESHOLD = 40;

function sentimentLabel(score: number | null): string {
  if (score === null) return "not scored";
  if (score < ESCALATION_THRESHOLD) return `${score}/100 (negative — call the customer back)`;
  if (score < 60) return `${score}/100 (neutral)`;
  return `${score}/100 (positive)`;
}

/** Render the alert the dealership manager receives. */
export function renderManagerAlert(
  callSid: string,
  coordinates: Coordinates,
  sentimentScore: number | null,
): ManagerAlert {
  const urgent = sentimentScore !== null && sentimentScore < ESCALATION_THRESHOLD;
  const place = coordinates.address ?? formatCoordinates(coordinates);
  const link = mapsLink(coordinates);

  const rows: [string, string][] = [
    ["Call SID", callSid],
    ["GPS", formatCoordinates(coordinates)],
    ["Location", place],
    ["Map", link],
    ["Last sentiment", sentimentLabel(sentimentScore)],
    ["Raised at", new Date().toISOString()],
  ];
  if (coordinates.accuracyMeters !== undefined) {
    rows.push(["GPS accuracy", `${Math.round(coordinates.accuracyMeters)} m`]);
  }

  return {
    subject: `${urgent ? "[URGENT] " : ""}RSA dispatched — call ${callSid}`,
    text: [
      `A roadside assistance event was confirmed on call ${callSid}.`,
      "",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      urgent
        ? "The caller sounded unhappy. Please follow up personally once the technician arrives."
        : "No escalation needed based on call sentiment.",
    ].join("\n"),
    html: [
      `<p>A roadside assistance event was confirmed on call <strong>${callSid}</strong>.</p>`,
      "<table cellpadding=\"6\">",
      ...rows.map(
        ([label, value]) =>
          `<tr><td><strong>${label}</strong></td><td>${
            label === "Map" ? `<a href="${value}">Open in Maps</a>` : value
          }</td></tr>`,
      ),
      "</table>",
      urgent
        ? "<p style=\"color:#b00\">The caller sounded unhappy. Please follow up personally.</p>"
        : "<p>No escalation needed based on call sentiment.</p>",
    ].join(""),
  };
}

function buildSendGridRequest(alert: ManagerAlert, config: EmailConfig): ProviderRequest {
  return {
    label: "email:sendgrid",
    url: "https://api.sendgrid.com/v3/mail/send",
    method: "POST",
    headers: {
      authorization: `Bearer ${config.sendgridApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: config.managerEmail }] }],
      from: { email: config.from, name: "Consilium Voice Agent" },
      subject: alert.subject,
      content: [
        { type: "text/plain", value: alert.text },
        { type: "text/html", value: alert.html },
      ],
    }),
    preview: { to: maskEmail(config.managerEmail), subject: alert.subject },
    // SendGrid answers 202 with an empty body; the id is only in a header.
    readReference: () => null,
  };
}

/**
 * Nodemailer/SMTP delivery.
 *
 * Mocked like every other provider. Going live means installing `nodemailer`
 * and replacing this builder with a `transporter.sendMail()` call — the rest
 * of the pipeline is unchanged.
 */
function buildSmtpRequest(alert: ManagerAlert, config: EmailConfig): ProviderRequest {
  return {
    label: "email:smtp",
    url: config.smtpUrl,
    method: "POST",
    headers: { "content-type": "message/rfc822" },
    body: [
      `From: Consilium Voice Agent <${config.from}>`,
      `To: <${config.managerEmail}>`,
      `Subject: ${alert.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      alert.text,
    ].join("\r\n"),
    preview: { to: maskEmail(config.managerEmail), subject: alert.subject },
    readReference: () => null,
  };
}

/**
 * Alert the dealership manager that an RSA event happened, where the vehicle
 * is, and how the customer sounded.
 *
 * Never throws, for the same reason as the WhatsApp side.
 */
export async function sendEmailAlert(
  callSid: string,
  coordinates: Coordinates,
  sentimentScore: number | null,
  ctx: NotifyContext,
): Promise<NotificationResult> {
  const { config, log } = ctx;
  const childLog = log.child({
    channel: "email",
    callSid,
    to: maskEmail(config.email.managerEmail),
  });
  const startedAt = Date.now();

  try {
    const alert = renderManagerAlert(callSid, coordinates, sentimentScore);

    if (config.email.provider === "smtp" && config.transport === "http") {
      throw new DeliveryError(
        "SMTP delivery needs nodemailer; install it and wire transporter.sendMail() in buildSmtpRequest",
        { retryable: false },
      );
    }

    const request =
      config.email.provider === "sendgrid"
        ? buildSendGridRequest(alert, config.email)
        : buildSmtpRequest(alert, config.email);

    const outcome = await deliver(request, config, childLog);
    childLog.info(
      { reference: outcome.reference, attempts: outcome.attempts, durationMs: outcome.durationMs },
      "Manager alert sent",
    );
    return {
      channel: "email",
      ok: true,
      reference: outcome.reference,
      attempts: outcome.attempts,
      durationMs: outcome.durationMs,
    };
  } catch (error) {
    const message = describeError(error);
    childLog.error({ err: message }, "Manager alert failed after all attempts");
    return {
      channel: "email",
      ok: false,
      attempts: config.maxAttempts,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}
