import { INGEST_MAX_BYTES, POSTHOG_UPSTREAM } from '../core/config';
import { cleanBatch } from './ingest';
import type { Req, Res } from './http';

/** The PostHog project key, put in by the build from `VITE_POSTHOG_KEY` (`scripts/vercel-output.mjs`); '' for none. */
declare const __POSTHOG_KEY__: string;

/** A request whose body can be read: Node's request is an async iterable of chunks. */
export interface BodyReq extends Req {
  method?: string;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

export interface IngestDeps {
  key: string;
  /** PostHog's host: `POSTHOG_UPSTREAM`, unless the server's environment names another (the local test server). */
  upstream: string;
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean }>;
}

/** The body as text, or null past `max` bytes. */
async function readBody(req: BodyReq, max: number): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > max) return null;
    chunks.push(bytes);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

function header(req: Req, name: string): string | null {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function reply(res: Res, status: number): void {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/**
 * `POST /<INGEST_PATH>` (function `ingest`): a batch of game events from `platform/posthog.ts`, checked and rebuilt
 * (`cleanBatch`) and sent on to PostHog's `/batch/` from this server, so PostHog never sees the player's IP address,
 * browser or any other header of theirs. Only a coarse country is added, from Vercel's own header. The game never
 * reads the answer, so every outcome is a bare status: 204 sent (or dropped: no key, or not this project's batch),
 * 400 not JSON, 405 not a POST, 413 too big, 502 PostHog failed or timed out.
 */
export async function ingest(req: BodyReq, res: Res, deps: IngestDeps): Promise<void> {
  if (req.method !== 'POST') return reply(res, 405);
  const body = await readBody(req, INGEST_MAX_BYTES);
  if (body === null) return reply(res, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(res, 400);
  }
  const batch = cleanBatch(parsed, deps.key, header(req, 'x-vercel-ip-country'));
  if (!batch) return reply(res, 204);
  try {
    const sent = await deps.fetch(`${deps.upstream.replace(/\/+$/, '')}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5000),
    });
    reply(res, sent.ok ? 204 : 502);
  } catch {
    reply(res, 502);
  }
}

/** The environment a Vercel function runs in, read without Node's types. */
function env(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name];
}

export default function handler(req: BodyReq, res: Res): Promise<void> {
  return ingest(req, res, {
    key: __POSTHOG_KEY__,
    upstream: env('POSTHOG_UPSTREAM') || POSTHOG_UPSTREAM,
    fetch: (url, init) => fetch(url, init),
  });
}
