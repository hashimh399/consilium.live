import type { WhatsAppConfig } from "../config.js";
import { deliver, type ProviderRequest } from "../delivery/transport.js";
import { describeError } from "../delivery/errors.js";
import { maskPhone } from "../logger.js";
import { formatCoordinates, mapsLink, type Coordinates, type NotificationResult } from "../types.js";
import type { NotifyContext } from "./context.js";

/** The message the customer receives once roadside assistance is dispatched. */
export function renderWhatsAppBody(coordinates: Coordinates): string {
  const place = coordinates.address ?? formatCoordinates(coordinates);
  return [
    "PAL Jay Roadside Assistance",
    "",
    `Your request is confirmed. Our technician is on the way to ${place}.`,
    `Location we have on file: ${mapsLink(coordinates)}`,
    "",
    "Estimated arrival is 45 minutes. Please stay with your vehicle in a safe spot.",
    "Reply HELP if anything changes.",
  ].join("\n");
}

function buildMetaRequest(
  phoneNumber: string,
  body: string,
  config: WhatsAppConfig,
): ProviderRequest {
  return {
    label: "whatsapp:meta",
    url: `https://graph.facebook.com/${config.metaGraphVersion}/${config.metaPhoneNumberId}/messages`,
    method: "POST",
    headers: {
      authorization: `Bearer ${config.metaAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "text",
      text: { preview_url: true, body },
    }),
    preview: { to: maskPhone(phoneNumber), chars: body.length },
    readReference: (payload) => {
      const messages = (payload as { messages?: { id?: string }[] } | null)?.messages;
      return messages?.[0]?.id ?? null;
    },
  };
}

function buildTwilioRequest(
  phoneNumber: string,
  body: string,
  config: WhatsAppConfig,
): ProviderRequest {
  const credentials = Buffer.from(
    `${config.twilioAccountSid}:${config.twilioAuthToken}`,
  ).toString("base64");

  return {
    label: "whatsapp:twilio",
    url: `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: `whatsapp:${config.from}`,
      To: `whatsapp:${phoneNumber}`,
      Body: body,
    }).toString(),
    preview: { to: maskPhone(phoneNumber), from: maskPhone(config.from), chars: body.length },
    readReference: (payload) => (payload as { sid?: string } | null)?.sid ?? null,
  };
}

/**
 * Tell the customer their roadside assistance request is on its way.
 *
 * Never throws: a failure here must not stop the manager alert from going
 * out, so the outcome is returned for the caller to log and act on.
 */
export async function sendWhatsAppConfirmation(
  phoneNumber: string,
  coordinates: Coordinates,
  ctx: NotifyContext,
): Promise<NotificationResult> {
  const { config, log } = ctx;
  const childLog = log.child({ channel: "whatsapp", to: maskPhone(phoneNumber) });
  const startedAt = Date.now();

  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    const error = "caller number is not a usable phone number";
    childLog.error({ err: error }, "WhatsApp confirmation skipped");
    return {
      channel: "whatsapp",
      ok: false,
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error,
    };
  }

  try {
    const body = renderWhatsAppBody(coordinates);
    const request =
      config.whatsapp.provider === "meta"
        ? buildMetaRequest(phoneNumber, body, config.whatsapp)
        : buildTwilioRequest(phoneNumber, body, config.whatsapp);

    const outcome = await deliver(request, config, childLog);
    childLog.info(
      { reference: outcome.reference, attempts: outcome.attempts, durationMs: outcome.durationMs },
      "WhatsApp confirmation sent",
    );
    return {
      channel: "whatsapp",
      ok: true,
      reference: outcome.reference,
      attempts: outcome.attempts,
      durationMs: outcome.durationMs,
    };
  } catch (error) {
    const message = describeError(error);
    childLog.error({ err: message }, "WhatsApp confirmation failed after all attempts");
    return {
      channel: "whatsapp",
      ok: false,
      attempts: config.maxAttempts,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}
