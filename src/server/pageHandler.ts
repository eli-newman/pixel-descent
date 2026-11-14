import { decodeDare } from '../core/dare';
import { originOf, queryParam, type Req, type Res } from './http';
import { darePage } from './page';

/** The built `index.html`, put in by the build (`scripts/vercel-output.mjs`). */
declare const __INDEX_HTML__: string;

/** `/c/<code>`: the game, with this dare's link preview. A code that is not a dare goes to the plain game. */
export default function handler(req: Req, res: Res): void {
  const dare = decodeDare(queryParam(req, 'code'));
  if (!dare) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The page holds this deployment's asset names, so caches keep it only briefly.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.end(darePage(__INDEX_HTML__, dare, originOf(req)));
}
