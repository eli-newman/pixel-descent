/**
 * The parts of Node's request and response the handlers use (the project has no @types/node). Vercel's Node.js
 * launcher calls a function's default export with these.
 */
export interface Req {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface Res {
  statusCode: number;
  setHeader(name: string, value: string | number): void;
  end(body?: string | Uint8Array): void;
}

function header(req: Req, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** `https://<host>` the request came in on, as Vercel forwards it. */
export function originOf(req: Req): string {
  const host = header(req, 'x-forwarded-host') || header(req, 'host') || 'powline.vercel.app';
  const proto = header(req, 'x-forwarded-proto') || 'https';
  return `${proto.split(',')[0]?.trim() || 'https'}://${host.split(',')[0]?.trim() ?? host}`;
}

/** A query value from the request URL (the routes pass the dare code as `?code=`). */
export function queryParam(req: Req, name: string): string | null {
  try {
    return new URL(req.url ?? '/', 'http://x').searchParams.get(name);
  } catch {
    return null;
  }
}
