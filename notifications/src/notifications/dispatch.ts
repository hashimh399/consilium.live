import { describeError } from "../delivery/errors.js";
import { maskPhone } from "../logger.js";
import { formatCoordinates, type NotificationResult, type RsaConfirmedEvent } from "../types.js";
import type { NotifyContext } from "./context.js";
import { sendEmailAlert } from "./email.js";
import { sendWhatsAppConfirmation } from "./whatsapp.js";

export interface DispatchSummary {
  callSid: string;
  whatsapp: NotificationResult;
  email: NotificationResult;
  allDelivered: boolean;
}

/**
 * Fan one confirmed RSA event out to the customer and the manager.
 *
 * Both notifications run concurrently and independently: a WhatsApp outage
 * must not stop the dealership from hearing about a stranded customer.
 */
export async function dispatchRsaNotifications(
  event: RsaConfirmedEvent,
  sentimentScore: number | null,
  ctx: NotifyContext,
): Promise<DispatchSummary> {
  const log = ctx.log.child({ callSid: event.callSid });
  log.info(
    {
      caller: maskPhone(event.callerNumber),
      gps: formatCoordinates(event.coordinates),
      sentimentScore,
      transport: ctx.config.transport,
    },
    "RSA confirmed, dispatching notifications",
  );

  const [whatsapp, email] = await Promise.all([
    guard("whatsapp", ctx, () =>
      sendWhatsAppConfirmation(event.callerNumber, event.coordinates, { ...ctx, log }),
    ),
    guard("email", ctx, () =>
      sendEmailAlert(event.callSid, event.coordinates, sentimentScore, { ...ctx, log }),
    ),
  ]);

  const allDelivered = whatsapp.ok && email.ok;
  const noneDelivered = !whatsapp.ok && !email.ok;
  const summaryFields = {
    whatsapp: { ok: whatsapp.ok, attempts: whatsapp.attempts, reference: whatsapp.reference },
    email: { ok: email.ok, attempts: email.attempts, reference: email.reference },
  };

  if (allDelivered) {
    log.info(summaryFields, "RSA notifications delivered");
  } else if (noneDelivered) {
    log.error(summaryFields, "RSA notifications all failed — nobody was told");
  } else {
    log.warn(summaryFields, "RSA notifications partially failed");
  }

  return { callSid: event.callSid, whatsapp, email, allDelivered };
}

/**
 * Both senders already swallow their own errors; this is the backstop for a
 * programming mistake so one broken channel cannot reject the whole dispatch.
 */
async function guard(
  channel: NotificationResult["channel"],
  ctx: NotifyContext,
  run: () => Promise<NotificationResult>,
): Promise<NotificationResult> {
  try {
    return await run();
  } catch (error) {
    const message = describeError(error);
    ctx.log.error({ channel, err: message }, "Notification threw unexpectedly");
    return { channel, ok: false, attempts: 0, durationMs: 0, error: message };
  }
}
