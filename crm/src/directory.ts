export interface LookupSuccess {
  status: "success";
  source: string;
  data: Record<string, string>;
}

export interface LookupMiss {
  status: "failed";
  source: "CRM (No Match)";
  data: { ownership_type: "UNKNOWN" };
}

interface DirectoryRow {
  source: string;
  data: Record<string, string>;
}

/** Last 10 digits, so 09906358704 and +91 9906358704 hit the same row. */
export function normalizeAni(ani: string): string {
  const digits = ani.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const DIRECTORY = new Map<string, DirectoryRow>([
  [
    "6005802921",
    {
      source: "DMS (PAL Jay Jammu)",
      data: {
        name: "Arjun Sharma",
        vip_status: "Gold",
        vehicle_owned: "Seltos HTX",
        vehicle: "Seltos HTX",
        vin_last_4: "4491",
        ownership_type: "EXISTING OWNER",
        last_service_date: "2024-08-10",
        last_service_package: "10,000 km periodic maintenance",
        next_service: "20,000 km periodic maintenance",
        preferred_dealer: "PAL Jay Jammu",
      },
    },
  ],
  [
    "9906358704",
    {
      source: "CRM (Lead Capture)",
      data: {
        name: "Sarah Khan",
        vip_status: "Silver",
        vehicle_owned: "N/A",
        vin_last_4: "N/A",
        ownership_type: "HOT LEAD",
        last_service_date: "N/A",
        preferred_dealer: "PAL Jay Srinagar",
        interest_notes:
          "DMS lead lookup: deep interest in the EV6 GT and the EV9 GT-Line. No vehicle or VIN is on file.",
      },
    },
  ],
]);

const MISS: LookupMiss = {
  status: "failed",
  source: "CRM (No Match)",
  data: { ownership_type: "UNKNOWN" },
};

export function lookupCaller(ani: string): LookupSuccess | LookupMiss {
  const row = DIRECTORY.get(normalizeAni(ani));
  if (row === undefined) return MISS;
  return { status: "success", source: row.source, data: row.data };
}
