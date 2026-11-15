import { encodeDare, type Dare } from '../core/dare';
import { isDailySeed } from '../core/rng';
import { CARD_H, CARD_SCALE, CARD_W, endLine } from '../render/share';

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The preview's title: the score to beat. */
export function dareTitle(d: Readonly<Dare>): string {
  return isDailySeed(d.seed) ? `Beat ${d.score} on today's Powline` : `Beat ${d.score} on Powline`;
}

/** The preview's description: the run in a sentence, then the dare. */
export function dareDescription(d: Readonly<Dare>): string {
  const ended = endLine(d.end).toLowerCase();
  const stars = `${d.stars} star${d.stars === 1 ? '' : 's'}`;
  const tricks = `${d.tricks} trick${d.tricks === 1 ? '' : 's'}`;
  return `${d.dist}m, ${stars}, ${tricks}, then ${ended}. Same course, your turn.`;
}

/**
 * The game's own page for a dare link, with link preview tags for this dare: the page Vercel serves at `/c/<code>`.
 * `index` is the built `index.html`, whose asset paths are relative, so a `<base>` points them back at the site's
 * root. Its own preview tags are dropped and the dare's put in: a title with the score to beat, a sentence about the
 * run and the card image (`/c/<code>/card.png`). The game reads the code from the address and then clears it.
 */
export function darePage(index: string, d: Readonly<Dare>, origin: string): string {
  const url = `${origin}/c/${encodeDare(d)}`;
  const image = `${url}/card.png`;
  const title = escape(dareTitle(d));
  const description = escape(dareDescription(d));
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Powline" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escape(url)}" />`,
    `<meta property="og:image" content="${escape(image)}" />`,
    `<meta property="og:image:width" content="${CARD_W * CARD_SCALE}" />`,
    `<meta property="og:image:height" content="${CARD_H * CARD_SCALE}" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escape(image)}" />`,
  ].join('\n    ');
  return index
    .replace(/<meta\s[^>]*(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/g, '')
    .replace(/<head>/, '<head>\n    <base href="/" />')
    .replace(/\s*<\/head>/, `\n    ${tags}\n  </head>`);
}
