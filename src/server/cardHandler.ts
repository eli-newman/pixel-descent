import { decodeDare } from '../core/dare';
import { cardPng } from './card';
import { queryParam, type Req, type Res } from './http';

/** `/c/<code>/card.png`: the dare's card. A code always draws the same card, so it is cached for a long time (a new deployment starts a fresh cache). */
export default function handler(req: Req, res: Res): void {
  const dare = decodeDare(queryParam(req, 'code'));
  if (!dare) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not a dare');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000');
  res.end(cardPng(dare));
}
