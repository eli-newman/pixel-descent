/**
 * What the ingest function lets through to PostHog. Pure. The game sends PostHog's `/batch/` payload
 * (`platform/posthog.ts`); this rebuilds it from only the fields PostHog needs, with flat short values, and forces
 * the privacy flags whatever the client sent. Anything else is dropped.
 */

/** Events in one batch, and the longest name, id or value kept. */
const MAX_EVENTS = 50;
const MAX_TEXT = 200;
const MAX_PROPS = 20;
/** Property names: plain snake_case words. PostHog's own `$` properties are set here, never taken from the client. */
const PROP_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** A two-letter country code, as Vercel's `x-vercel-ip-country` header gives it. */
const COUNTRY = /^[A-Z]{2}$/;

type Value = string | number | boolean;

export interface CleanEvent {
  event: string;
  distinct_id: string;
  timestamp?: string;
  properties: Record<string, Value>;
}

export interface CleanBatch {
  api_key: string;
  batch: CleanEvent[];
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
}

function cleanEvent(raw: unknown, country: string | null): CleanEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!text(e['event']) || !text(e['distinct_id'])) return null;
  const properties: Record<string, Value> = {};
  const props = e['properties'];
  if (props && typeof props === 'object') {
    for (const [k, v] of Object.entries(props)) {
      if (Object.keys(properties).length >= MAX_PROPS) break;
      if (!PROP_NAME.test(k)) continue;
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || text(v)) {
        properties[k] = v;
      }
    }
  }
  if (country) properties['country'] = country;
  properties['$process_person_profile'] = false;
  properties['$geoip_disable'] = true;
  const out: CleanEvent = { event: e['event'], distinct_id: e['distinct_id'], properties };
  if (typeof e['timestamp'] === 'string' && TIMESTAMP.test(e['timestamp'])) {
    out.timestamp = e['timestamp'];
  }
  return out;
}

/**
 * The batch to forward, or null if it is not one for this project (`key`). `countryHeader` is Vercel's guess at the
 * player's country from their IP, which is the only thing kept from it.
 */
export function cleanBatch(
  body: unknown,
  key: string,
  countryHeader: string | null,
): CleanBatch | null {
  if (!key || !body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b['api_key'] !== key || !Array.isArray(b['batch'])) return null;
  const country = countryHeader && COUNTRY.test(countryHeader) ? countryHeader : null;
  const batch = b['batch']
    .slice(0, MAX_EVENTS)
    .map((e) => cleanEvent(e, country))
    .filter((e): e is CleanEvent => e !== null);
  return batch.length > 0 ? { api_key: key, batch } : null;
}
