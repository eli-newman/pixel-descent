import { describe, expect, it } from 'vitest';
import {
  analyticsConfig,
  cleanUrl,
  DEFAULT_SCRIPT,
  MAX_QUEUE,
  noTracker,
  startWebAnalytics,
  trimProps,
  type ScriptHost,
  type VaWindow,
} from '../src/platform/analytics';
import { distBucket, runBucket, scoreBucket, shareEvent } from '../src/state/telemetry';
import { makeGame, stepUntil } from './helpers/fakes';

/** A run from the title screen to game over. */
function playToOver(rig: ReturnType<typeof makeGame>): void {
  rig.input.push('start');
  rig.game.update(1 / 120);
  stepUntil(rig.game, () => rig.game.phase === 'over');
}

describe('run analytics', () => {
  it('sends a start and an end for each run, counting runs in this visit', () => {
    const rig = makeGame('crashy');
    playToOver(rig);
    const { game, analytics } = rig;
    expect(analytics.names()).toEqual(['Run Start', 'Run End']);
    expect(analytics.events[0]?.data).toEqual({ run: '1', setup: 'board mono normal' });
    const res = game.result;
    if (!res) throw new Error('no result');
    expect(analytics.events[1]?.data).toEqual({
      metres: distBucket(res.dist),
      score: scoreBucket(res.score),
      setup: 'board mono normal',
      run: '1',
    });

    // Another run from the game over screen is the second run.
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    rig.input.push('start');
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    expect(analytics.names()).toEqual(['Run Start', 'Run End', 'Run Start']);
    expect(analytics.events[2]?.data['run']).toBe('2');
  });

  it('labels skis, colour and the daily course', () => {
    const { game, analytics } = makeGame();
    game.update(1 / 120);
    game.press('gear');
    game.press('skis');
    game.press('back');
    game.press('color');
    game.press('daily');
    expect(analytics.events.at(-1)?.data).toEqual({ run: '1', setup: 'skis color daily' });
  });

  it('never sends the seed, the score to the point or anything but short labels', () => {
    const rig = makeGame('k1secretq');
    playToOver(rig);
    rig.game.press('restart');
    const sent = JSON.stringify(rig.analytics.events);
    expect(sent).not.toContain('k1secretq');
    expect(sent).not.toContain(rig.game.seed);
    for (const e of rig.analytics.events) {
      for (const v of Object.values(e.data)) expect(typeof v).toBe('string');
    }
  });

  it('does not change the run: the same course plays the same with or without a tracker', () => {
    const a = makeGame('same');
    const b = makeGame('same', { analytics: undefined });
    playToOver(a);
    playToOver(b);
    expect(b.analytics.events).toEqual([]);
    expect(a.game.result?.dist).toBe(b.game.result?.dist);
    expect(a.game.result?.score).toBe(b.game.result?.score);
  });

  it('describes a share by its path only', () => {
    expect(shareEvent('clipboard')).toEqual({ name: 'Share', data: { via: 'clipboard' } });
  });
});

describe('buckets', () => {
  it('puts distance, score and run number in coarse bands', () => {
    expect([0, 99, 100, 249, 250, 999, 1000, 4999, 5000, 99999, -5].map(distBucket)).toEqual([
      '0-99',
      '0-99',
      '100-249',
      '100-249',
      '250-499',
      '500-999',
      '1000-1999',
      '2000-4999',
      '5000+',
      '5000+',
      '0-99',
    ]);
    expect([0, 450, 1200, 30000].map(scoreBucket)).toEqual([
      '0-99',
      '100-499',
      '1000-2499',
      '25000+',
    ]);
    expect([1, 2, 3, 4, 5, 6, 10, 11, 40].map(runBucket)).toEqual([
      '1',
      '2',
      '3',
      '4-5',
      '4-5',
      '6-10',
      '6-10',
      '11+',
      '11+',
    ]);
  });
});

describe('cleanUrl', () => {
  it('drops the seed, other query values and the hash, keeping campaign tags', () => {
    expect(cleanUrl('https://powline.vercel.app/?seed=k1abc&fbclid=x#top', false)).toBe(
      'https://powline.vercel.app/',
    );
    expect(cleanUrl('https://powline.vercel.app/?utm_source=tiktok&seed=k1abc', false)).toBe(
      'https://powline.vercel.app/?utm_source=tiktok',
    );
  });

  it('reports a visit from a shared link as the from-share page, in the folder the game is in', () => {
    expect(cleanUrl('https://powline.vercel.app/?seed=k1abc', true)).toBe(
      'https://powline.vercel.app/from-share',
    );
    expect(cleanUrl('https://example.com/games/powline/', true)).toBe(
      'https://example.com/games/powline/from-share',
    );
  });

  it('gives an empty string (the event is dropped) for something that is not a URL', () => {
    expect(cleanUrl('not a url', false)).toBe('');
  });
});

describe('analyticsConfig', () => {
  it('reads the paths Vercel passes at build time, and falls back to the default script', () => {
    expect(analyticsConfig(undefined)).toEqual({ scriptSrc: DEFAULT_SCRIPT });
    expect(analyticsConfig('{oops')).toEqual({ scriptSrc: DEFAULT_SCRIPT });
    for (const bad of ['https://evil.example/x.js', '//evil.example/x.js', '../x.js', 'a b.js']) {
      expect(analyticsConfig(JSON.stringify({ analytics: { scriptSrc: bad } }))).toEqual({
        scriptSrc: DEFAULT_SCRIPT,
      });
    }
    // The shape Vercel really sends (seen in a preview build): paths without the leading slash.
    expect(
      analyticsConfig(
        JSON.stringify({
          analytics: {
            scriptSrc: '76b40da1c7a41f39/script.js',
            viewEndpoint: '76b40da1c7a41f39/view',
            eventEndpoint: '76b40da1c7a41f39/event',
            sessionEndpoint: '76b40da1c7a41f39/session',
          },
          speedInsights: { scriptSrc: '7d6cb9d1e2893893/script.js' },
        }),
      ),
    ).toEqual({
      scriptSrc: '/76b40da1c7a41f39/script.js',
      viewEndpoint: '/76b40da1c7a41f39/view',
      eventEndpoint: '/76b40da1c7a41f39/event',
    });
    expect(
      analyticsConfig(
        JSON.stringify({
          analytics: {
            scriptSrc: '/abc/script.js',
            viewEndpoint: '/abc/view',
            eventEndpoint: '/abc/event',
          },
        }),
      ),
    ).toEqual({
      scriptSrc: '/abc/script.js',
      viewEndpoint: '/abc/view',
      eventEndpoint: '/abc/event',
    });
  });
});

describe('trimProps', () => {
  it('keeps the first properties, in order', () => {
    expect(trimProps({ a: '1', b: '2', c: '3' }, 2)).toEqual({ a: '1', b: '2' });
    expect(Object.keys(trimProps({ a: '1', b: '2', c: '3' }, 8))).toEqual(['a', 'b', 'c']);
  });
});

interface FakeScript {
  defer: boolean;
  src: string;
  dataset: Record<string, string>;
  onerror: (() => void) | null;
}

function fakeDoc(): ScriptHost & { added: FakeScript[] } {
  const added: FakeScript[] = [];
  return {
    added,
    createElement: () =>
      ({ defer: false, src: '', dataset: {}, onerror: null }) as unknown as HTMLScriptElement,
    head: { appendChild: (node) => added.push(node as unknown as FakeScript) },
  };
}

describe('startWebAnalytics', () => {
  it('queues a URL cleaner before the script loads, then events', () => {
    const win: VaWindow = {};
    const doc = fakeDoc();
    const tracker = startWebAnalytics(
      win,
      doc,
      { scriptSrc: '/abc/script.js', eventEndpoint: '/abc/event' },
      true,
    );
    expect(doc.added).toHaveLength(1);
    expect(doc.added[0]?.src).toBe('/abc/script.js');
    expect(doc.added[0]?.defer).toBe(true);
    expect(doc.added[0]?.dataset['eventEndpoint']).toBe('/abc/event');

    tracker.track({
      name: 'Run End',
      data: { metres: '0-99', score: '0-99', setup: 'x', run: '1' },
    });
    const q = win.vaq ?? [];
    expect(q.map((args) => args[0])).toEqual(['beforeSend', 'event']);
    // Only as many properties as the plan keeps.
    expect(q[1]?.[1]).toEqual({ name: 'Run End', data: { metres: '0-99', score: '0-99' } });

    const beforeSend = q[0]?.[1] as (e: { type: string; url: string }) => { url: string } | null;
    expect(beforeSend({ type: 'pageview', url: 'https://powline.vercel.app/?seed=k1abc' })).toEqual(
      {
        type: 'pageview',
        url: 'https://powline.vercel.app/from-share',
      },
    );
    expect(beforeSend({ type: 'event', url: 'junk' })).toBeNull();
  });

  it('turns into a no-op when the script is blocked, and the queue never grows without bound', () => {
    const win: VaWindow = {};
    const doc = fakeDoc();
    const tracker = startWebAnalytics(win, doc, { scriptSrc: DEFAULT_SCRIPT }, false);
    for (let i = 0; i < MAX_QUEUE * 3; i++)
      tracker.track({ name: 'Run Start', data: { run: '1' } });
    expect(win.vaq?.length).toBe(MAX_QUEUE);

    doc.added[0]?.onerror?.();
    expect(win.vaq).toEqual([]);
    expect(() => tracker.track({ name: 'Run Start', data: { run: '1' } })).not.toThrow();
    expect(win.vaq).toEqual([]);
  });

  it('never throws, even when the page or the script does', () => {
    const throwing: ScriptHost = {
      createElement: () => {
        throw new Error('no DOM');
      },
      head: { appendChild: () => 0 },
    };
    expect(startWebAnalytics({}, throwing, { scriptSrc: DEFAULT_SCRIPT }, false)).toBe(noTracker);

    const win: VaWindow = {};
    const tracker = startWebAnalytics(win, fakeDoc(), { scriptSrc: DEFAULT_SCRIPT }, false);
    win.va = () => {
      throw new Error('script bug');
    };
    expect(() => tracker.track({ name: 'Share', data: { via: 'clipboard' } })).not.toThrow();
  });
});
