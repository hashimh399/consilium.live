/** A GPS fix taken from the caller's phone during the RSA flow. */
export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Reverse-geocoded street address, when the voice agent had one. */
  address?: string;
  /** Accuracy radius in metres, when the handset reported it. */
  accuracyMeters?: number;
}

/** A confirmed Roadside Assistance request, ready to be acted on. */
export interface RsaConfirmedEvent {
  callSid: string;
  callerNumber: string;
  coordinates: Coordinates;
  /** Free-text description of the breakdown, if the caller gave one. */
  notes?: string;
  confirmedAt: string;
}

export type NotificationChannel = "whatsapp" | "email";

export interface NotificationResult {
  channel: NotificationChannel;
  ok: boolean;
  /** Provider-side id, present on success. */
  reference?: string;
  attempts: number;
  durationMs: number;
  error?: string;
}

export function formatCoordinates(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

export function mapsLink(coordinates: Coordinates): string {
  return `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`;
}
