export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new HttpError(res.status, `Request to ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Stats {
  total_calls: number;
  ai_handled_calls: number;
  leads: number;
  hot_leads: number;
  test_drives: number;
  service_appointments: number;
}

export interface Call {
  id: number;
  call_sid: string;
  from_number: string | null;
  to_number: string | null;
  status: string;
  intent: string | null;
  summary: string | null;
  lead_score: string | null;
  next_action: string | null;
  handed_off: boolean;
  started_at: string | null;
  ended_at: string | null;
}

export interface Message {
  id: number;
  role: string;
  content: string;
  created_at: string | null;
}

export interface Lead {
  id: number;
  call_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  budget: string | null;
  preferred_model: string | null;
  fuel_type: string | null;
  transmission: string | null;
  passengers: string | null;
  timeline: string | null;
  recommended_model: string | null;
  notes: string | null;
  score: string | null;
  score_reasons: string | null;
  status: string;
  created_at: string | null;
}

export interface TestDrive {
  id: number;
  call_id: number;
  lead_id: number | null;
  model: string | null;
  name: string | null;
  phone: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  status: string;
  created_at: string | null;
}

export interface ServiceAppointment {
  id: number;
  call_id: number;
  customer_name: string | null;
  phone: string | null;
  vehicle_model: string | null;
  registration_number: string | null;
  service_requirement: string | null;
  preferred_time: string | null;
  status: string;
  created_at: string | null;
}

export interface ExchangeEnquiry {
  id: number;
  call_id: number;
  customer_name: string | null;
  phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  year: string | null;
  variant: string | null;
  km: string | null;
  condition: string | null;
  created_at: string | null;
}

export interface CallDetail extends Call {
  messages: Message[];
  leads: Lead[];
  test_drives: TestDrive[];
  service_appointments: ServiceAppointment[];
  exchange_enquiries: ExchangeEnquiry[];
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
