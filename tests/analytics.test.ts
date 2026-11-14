import { describe, expect, it } from 'vitest';
import { INGEST_MAX_BYTES, LESSON_GUARD, SAVE_PREFIX, SESSION_GAP_MS } from '../src/core/config';
import { encodeDare, type Dare } from '../src/core/dare';
import {
  analyticsConfig,
  cleanUrl,
  DEFAULT_SCRIPT,
  MAX_QUEUE,
  noTracker,
  startWebAnalytics,
  trimProps,
  type AnalyticsEvent,
  type ScriptHost,
  type VaWindow,
} from '../src/platform/analytics';
import {
  fanOut,
  posthogConfig,
  startPostHog,
  visitId,
  type BatchBody,
  type Sender,
} from '../src/platform/posthog';
import { cleanBatch } from '../src/server/ingest';
import { ingest, type BodyReq } from '../src/server/ingestHandler';
import type { Res } from '../src/server/http';
import { runEnd } from '../src/state/runReport';
import {
  bestBand,
  dareOutcome,
  dayActiveEvent,
  dayBucket,
  daysSince,
  distBucket,
  gameLoadedEvent,
  isoWeek,
  lengthBucket,
  loadBucket,
  runBucket,
  runEndedEvent,
  runMode,
  runSharedEvent,
  Session,
  triesBucket,
  unlockEarnedEvent,
  withContext,
} from '../src/state/telemetry';
import { ALL_LESSONS, markSeen } from '../src/state/tutorial';
import { makeGame, memoryStorage, stepUntil, type Rig } from './helpers/fakes';

const STEP = 1 / 120;

/** A run from the title screen to game over, and on until another run may start. */
function playToOver(rig: Rig): void {
  rig.input.push('start');
  rig.game.update(STEP);
  stepUntil(rig.game, () => rig.game.phase === 'over');
  stepUntil(rig.game, () => rig.game.overReady);
}

/** Ride a run for a second, then pause it. */
function rideThenPause(rig: Rig): void {
  rig.input.push('start');
  for (let i = 0; i < 120; i++) rig.game.update(STEP);
  rig.game.togglePause();
}

function named(rig: Rig, name: string): AnalyticsEvent[] {
  return rig.analytics.events.filter((e) => e.name === name);
}

/** The context every event carries for the rig's first-time player on 20 October 2026. */
const NEW_DIRECT = { player: 'new', days_since_first: '0', source: 'direct' };

/** A save from a player who started a week before the rig's day (20 October 2026). */
function returningSave(): ReturnType<typeof memoryStorage> {
  const storage = memoryStorage();
  storage.setItem(
    `${SAVE_PREFIX}progress`,
    JSON.stringify({ stats: { runs: 5, lessons: ALL_LESSONS, firstDay: '2026-10-13' } }),
  );
  return storage;
}

const DARE: Dare = {
  seed: 'k3m9qa',
  score: 1240,
  dist: 312,
  stars: 4,
  tricks: 3,
  end: 'tree',
  skis: false,
  board: 0,
  rider: 0,
};

describe('run analytics', () => {
  it('sends a start and an end for each run, numbered in the life of the player and in this visit', () => {
    const rig = makeGame('crashy');
    playToOver(rig);
    const { game } = rig;
    const res = game.result;
    if (!res) throw new Error('no result');
    expect(named(rig, 'Run Started').map((e) => e.data)).toEqual([
      { mode: 'normal', kit: 'board', life_run: '1', visit_run: '1', ...NEW_DIRECT },
    ]);
    const ended = named(rig, 'Run Ended');
    expect(ended.map((e) => e.data)).toEqual([
      {
        metres: distBucket(res.dist),
        end: 'crash',
        best: bestBand(res.score, 0, res.newBest),
        cause: runEnd(res.summary.cause, game.sim.killer?.kind ?? null),
        mode: 'normal',
        life_run: '1',
        ...NEW_DIRECT,
      },
    ]);
    // Most important first: Vercel keeps only the first two.
    expect(Object.keys(ended[0]?.data ?? {}).slice(0, 2)).toEqual(['metres', 'end']);

    // Another run from the game over screen is the second of both.
    rig.input.push('start');
    game.update(STEP);
    expect(game.phase).toBe('playing');
    expect(named(rig, 'Run Started')[1]?.data).toMatchObject({ life_run: '2', visit_run: '2' });
  });

  it('counts runs over the whole life of the player, not just this visit', () => {
    const rig = makeGame('crashy', {}, returningSave());
    rig.game.press('play');
    expect(named(rig, 'Run Started')[0]?.data).toEqual({
      mode: 'normal',
      kit: 'board',
      life_run: '6-10',
      visit_run: '1',
      player: 'returning',
      days_since_first: '7',
      source: 'direct',
    });
  });

  it('labels skis, the daily course, a dare and a run from a shared link', () => {
    const { game, analytics } = makeGame();
    game.update(STEP);
    game.press('gear');
    game.press('skis');
    game.press('back');
    game.press('daily');
    expect(analytics.events.at(-1)?.data).toMatchObject({ mode: 'daily', kit: 'skis' });

    const dare = makeGame('x', { fromShare: true }, undefined, { dare: DARE });
    dare.game.press('play');
    expect(dare.analytics.events.at(-1)?.data).toMatchObject({ mode: 'dare', source: 'dare' });
  });

  it('sends Day Active before the first event of each local day, with the week the player started', () => {
    let now = new Date(2026, 9, 20, 23, 59);
    const rig = makeGame('crashy', { now: () => now });
    rig.game.press('play');
    rig.game.togglePause();
    rig.game.press('restart');
    now = new Date(2026, 9, 21, 0, 1);
    rig.game.press('restart');
    expect(rig.analytics.names()).toEqual([
      'Day Active',
      'Run Started',
      'Run Ended',
      'Run Started',
      'Day Active',
      'Run Ended',
      'Run Started',
    ]);
    // No run has finished, so the player has not started: their week is this one, and every day is day 0.
    const days = named(rig, 'Day Active');
    expect(days[0]?.data).toEqual({ cohort_week: '2026-W43', ...NEW_DIRECT });
    expect(days[1]?.data).toEqual({ cohort_week: '2026-W43', ...NEW_DIRECT });

    const back = makeGame('crashy', {}, returningSave());
    back.game.press('play');
    expect(named(back, 'Day Active')[0]?.data).toEqual({
      cohort_week: '2026-W42',
      player: 'returning',
      days_since_first: '7',
      source: 'direct',
    });
  });

  it('ends a run that is quit, restarted or left, once, with no cause unless it crashed', () => {
    const quit = makeGame('crashy');
    rideThenPause(quit);
    quit.game.press('quit');
    expect(named(quit, 'Run Ended').map((e) => [e.data['end'], e.data['cause']])).toEqual([
      ['quit', 'none'],
    ]);
    expect(quit.game.phase).toBe('title');

    const restart = makeGame('crashy');
    rideThenPause(restart);
    restart.game.press('restart');
    expect(restart.analytics.names()).toEqual([
      'Day Active',
      'Run Started',
      'Run Ended',
      'Run Started',
    ]);
    expect(named(restart, 'Run Ended')[0]?.data).toMatchObject({ end: 'quit', life_run: '1' });

    // RETRY while the rider still tumbles: the run crashed, though it never reached game over.
    const tumble = makeGame('crashy');
    tumble.input.push('start');
    stepUntil(tumble.game, () => tumble.game.phase === 'crashed');
    const cause = runEnd(tumble.game.sim.crashCause, tumble.game.sim.killer?.kind ?? null);
    tumble.input.push('retry');
    tumble.game.update(STEP);
    expect(named(tumble, 'Run Ended')[0]?.data).toMatchObject({
      end: 'crash',
      cause,
    });
    expect(cause).not.toBe('none');

    const left = makeGame('crashy');
    rideThenPause(left);
    left.game.leave();
    left.game.leave();
    expect(named(left, 'Run Ended').map((e) => e.data['end'])).toEqual(['left']);

    // A run that reached game over has ended already: MENU or leaving the page adds nothing.
    const over = makeGame('crashy');
    playToOver(over);
    over.game.press('menu');
    over.game.leave();
    expect(named(over, 'Run Ended')).toHaveLength(1);
  });

  it('reports what the player did next from game over, each action once', () => {
    const rig = makeGame('crashy');
    playToOver(rig);
    rig.game.press('share');
    rig.game.press('share');
    rig.input.push('start');
    rig.game.update(STEP);
    playToOver(rig);
    rig.input.push('retry');
    rig.game.update(STEP);
    playToOver(rig);
    rig.game.press('menu');
    expect(named(rig, 'Next Action').map((e) => e.data['action'])).toEqual([
      'share',
      'again',
      'retry',
      'menu',
    ]);
  });

  it('sends a dare result with the tries at it, and a share says how the dare went', () => {
    const rig = makeGame('x', { fromShare: true }, undefined, { dare: DARE });
    playToOver(rig);
    const res = rig.game.result;
    if (!res) throw new Error('no result');
    rig.game.trackShare('clipboard');
    rig.game.press('retry');
    playToOver(rig);
    const outcome = dareOutcome(res.score, DARE.score);
    expect(named(rig, 'Dare Result').map((e) => e.data)).toEqual([
      { outcome, tries: '1', player: 'new', days_since_first: '0', source: 'dare' },
      expect.objectContaining({ tries: '2-3' }),
    ]);
    expect(named(rig, 'Run Shared')[0]?.data).toEqual({
      via: 'clipboard',
      mode: 'dare',
      dare_result: outcome,
      player: 'new',
      days_since_first: '0',
      source: 'dare',
    });
  });

  it('sends what a run unlocked', () => {
    const rig = makeGame('crashy');
    // One short of the 50 close calls that unlock the EARS rider.
    rig.store.progress().stats.nearMisses = 49;
    rig.store.progress().stats.bestDist = 499;
    playToOver(rig);
    const res = rig.game.result;
    if (!res) throw new Error('no result');
    const expected = [
      ...res.achievements.map((a) => ['achievement', a.id]),
      ...res.gear.map((g) => ['gear', g.id]),
    ];
    expect(named(rig, 'Unlock Earned').map((e) => [e.data['kind'], e.data['id']])).toEqual(
      expected,
    );
    expect(unlockEarnedEvent('gear', 'ears')).toEqual({
      name: 'Unlock Earned',
      data: { kind: 'gear', id: 'ears' },
    });
  });

  it('never sends a seed, a dare code, an exact score or distance, or anything but short labels', () => {
    const rig = makeGame('k1secretq', { fromShare: true }, undefined, { dare: DARE });
    playToOver(rig);
    const res = rig.game.result;
    rig.game.trackShare('download');
    rig.game.press('retry');
    rig.game.togglePause();
    rig.game.press('quit');
    const sent = JSON.stringify(rig.analytics.events);
    for (const secret of ['k1secretq', DARE.seed, encodeDare(DARE), rig.game.seed]) {
      expect(sent).not.toContain(secret);
    }
    // Every value is a label or a band: a bare number only where it is a band of one.
    const BAND = /^(\d+-\d+|\d+\+|<\d+[sm]|\d+-\d+[sm]|\d+[sm]\+|\d{4}-W\d{2})$/;
    const bad = rig.analytics.events.flatMap((e) =>
      Object.values(e.data).filter(
        (v) =>
          typeof v !== 'string' ||
          !(
            /^[a-z][a-z0-9_-]*$/.test(v) ||
            BAND.test(v) ||
            ['0', '1', '2', '3', '7', '30'].includes(v)
          ),
      ),
    );
    expect(bad).toEqual([]);
    expect(res && res.score > 30).toBe(true);
  });

  it('does not change the run: the same course plays the same with or without a tracker', () => {
    const a = makeGame('same');
    const b = makeGame('same', { analytics: undefined });
    playToOver(a);
    playToOver(b);
    expect(b.analytics.events).toEqual([]);
    expect(a.analytics.events.length).toBeGreaterThan(0);
    expect(a.game.result?.dist).toBe(b.game.result?.dist);
    expect(a.game.result?.score).toBe(b.game.result?.score);
  });
});

describe('tutorial analytics', () => {
  /** A new player's first run, ridden until a lesson waits for a tap. */
  function untilLesson(rig: Rig): void {
    for (let k = 0; k < 120 * 10 && !rig.game.lessonReady; k++) rig.game.update(STEP);
  }

  it('sends each lesson shown and done, on a run labelled tutorial, and Tutorial Ended after the last', () => {
    const rig = makeGame('x', {}, undefined, { tutorial: true });
    // Only the steering lesson is left.
    rig.store.progress().stats.lessons = ALL_LESSONS & ~markSeen(0, 'steer');
    rig.game.newRun(rig.game.freshSeed());
    rig.input.push('start');
    rig.game.update(STEP);
    untilLesson(rig);
    expect(rig.game.lesson?.id).toBe('steer');
    for (let k = 0; k < 120 * LESSON_GUARD; k++) rig.game.update(STEP);
    rig.input.push('start');
    rig.game.update(STEP);
    expect(rig.analytics.names()).toEqual([
      'Day Active',
      'Run Started',
      'Lesson Shown',
      'Lesson Done',
      'Tutorial Ended',
    ]);
    expect(named(rig, 'Run Started')[0]?.data['mode']).toBe('tutorial');
    expect(named(rig, 'Lesson Shown')[0]?.data).toEqual({
      lesson: 'steer',
      tut_run: '1',
      ...NEW_DIRECT,
    });
    expect(named(rig, 'Lesson Done')[0]?.data).toMatchObject({ lesson: 'steer', tut_run: '1' });
    expect(named(rig, 'Tutorial Ended')[0]?.data).toMatchObject({ result: 'completed' });
  });

  it('says the tutorial was cut short when its runs run out with lessons left', () => {
    const rig = makeGame('x', {}, undefined, { tutorial: true });
    const stats = rig.store.progress().stats;
    // The last tutorial run, with only the steering lesson seen: this short run never reaches them all.
    stats.runs = 2;
    stats.lessons = markSeen(0, 'steer');
    // A course that crashes soon, before the tutorial's own course would have shown every lesson.
    rig.game.newRun('crashy');
    rig.input.push('start');
    rig.game.update(STEP);
    rig.game.togglePause();
    rig.game.togglePause();
    // Ride straight into whatever comes, going on from any lesson.
    stepUntil(rig.game, () => {
      if (rig.game.lessonReady) rig.input.push('start');
      return rig.game.phase === 'over';
    });
    expect(named(rig, 'Tutorial Ended').map((e) => e.data['result'])).toEqual(['cut_short']);
    expect(named(rig, 'Run Ended')[0]?.data).toMatchObject({ mode: 'tutorial', life_run: '3' });
  });
});

describe('sessions', () => {
  it('ends a session each time the page is hidden, and starts a new one after a long break', () => {
    const s = new Session(0, 0);
    expect(s.hide(30_000, 0)?.data).toEqual({ runs: '0', length: '<1m', resumed: 'no' });
    expect(s.hide(40_000, 0)).toBeNull();
    // Back within the gap: the same session, its hidden time not counted.
    s.show(100_000, 0);
    expect(s.hide(190_000, 2)?.data).toEqual({ runs: '2', length: '1-3m', resumed: 'yes' });
    // Back after the gap: a new session.
    s.show(190_000 + SESSION_GAP_MS, 2);
    expect(s.hide(190_000 + SESSION_GAP_MS + 11 * 60_000, 9)?.data).toEqual({
      runs: '6-10',
      length: '10-30m',
      resumed: 'no',
    });
  });
});

describe('bands', () => {
  it('puts distance, run counts, days, tries, load time and session length in coarse bands', () => {
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
    expect([0, 1, 2, 6, 7, 8, 29, 30, 31, 400].map(dayBucket)).toEqual([
      '0',
      '1',
      '2-6',
      '2-6',
      '7',
      '8-29',
      '8-29',
      '30',
      '31+',
      '31+',
    ]);
    expect([1, 2, 3, 4, 9].map(triesBucket)).toEqual(['1', '2-3', '2-3', '4+', '4+']);
    expect([0, 999, 1000, 3999, 4000, 9000].map(loadBucket)).toEqual([
      '<1s',
      '<1s',
      '1-2s',
      '2-4s',
      '4-8s',
      '8s+',
    ]);
    expect([0, 59_999, 60_000, 179_999, 600_000, 1_800_000].map(lengthBucket)).toEqual([
      '<1m',
      '<1m',
      '1-3m',
      '1-3m',
      '10-30m',
      '30m+',
    ]);
  });

  it('counts days between local dates and names ISO weeks', () => {
    expect(daysSince('2026-10-13', '2026-10-20')).toBe(7);
    expect(daysSince('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysSince('', '2026-10-20')).toBe(0);
    expect(daysSince('2026-10-21', '2026-10-20')).toBe(0);
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
    expect(isoWeek('2026-10-20')).toBe('2026-W43');
    expect(isoWeek('junk')).toBe('');
  });

  it('calls a run a new best, close to it, or neither', () => {
    expect(bestBand(500, 400, true)).toBe('new');
    expect(bestBand(360, 400, false)).toBe('close');
    expect(bestBand(359, 400, false)).toBe('no');
    expect(bestBand(0, 0, false)).toBe('no');
    expect(dareOutcome(10, 5)).toBe('beat');
    expect(dareOutcome(5, 5)).toBe('tied');
    expect(dareOutcome(4, 5)).toBe('short');
  });

  it('builds the page and share events from fixed labels', () => {
    expect(gameLoadedEvent(1500, 'broken_dare')).toEqual({
      name: 'Game Loaded',
      data: { landing: 'broken_dare', load_time: '1-2s' },
    });
    expect(runSharedEvent('clipboard', 'normal', 'none')).toEqual({
      name: 'Run Shared',
      data: { via: 'clipboard', mode: 'normal', dare_result: 'none' },
    });
    expect(dayActiveEvent('', '2026-10-20').data).toEqual({ cohort_week: '2026-W43' });
    expect(runMode({ kit: 'skis', daily: true, dare: true, tutorial: true })).toBe('dare');
    expect(runMode({ kit: 'skis', daily: true, dare: false, tutorial: true })).toBe('tutorial');
    expect(
      withContext(
        runEndedEvent({
          end: 'left',
          cause: 'none',
          metres: 42,
          best: 'no',
          setup: { kit: 'snowboard', daily: false, dare: false, tutorial: false },
          lifeRun: 12,
        }),
        { player: 'returning', firstDay: '2026-01-01', today: '2026-10-20', source: 'dare' },
      ),
    ).toEqual({
      name: 'Run Ended',
      data: {
        metres: '0-99',
        end: 'left',
        best: 'no',
        cause: 'none',
        mode: 'normal',
        life_run: '11+',
        player: 'returning',
        days_since_first: '31+',
        source: 'dare',
      },
    });
  });
});

describe('the first play day', () => {
  it('is set by the first finished run and kept after', () => {
    const storage = memoryStorage();
    const rig = makeGame('crashy', {}, storage);
    expect(rig.store.progress().stats.firstDay).toBe('');
    playToOver(rig);
    expect(rig.store.progress().stats.firstDay).toBe('2026-10-20');
    const later = makeGame('crashy', { now: () => new Date(2026, 10, 2) }, storage);
    playToOver(later);
    expect(later.store.progress().stats.firstDay).toBe('2026-10-20');
    expect(named(later, 'Run Ended')[0]?.data['days_since_first']).toBe('8-29');
  });

  it('is the earliest day an older save recorded, for saves from before it existed', () => {
    const storage = memoryStorage();
    storage.setItem(
      `${SAVE_PREFIX}progress`,
      JSON.stringify({
        stats: { runs: 9, firstDay: 'yesterday' },
        achievements: { d250: '2026-06-02' },
      }),
    );
    storage.setItem(
      `${SAVE_PREFIX}scores`,
      JSON.stringify({ best: 50, top: [{ score: 50, dist: 90, date: '2026-05-30' }], daily: null }),
    );
    const rig = makeGame('crashy', {}, storage);
    expect(rig.store.progress().stats.firstDay).toBe('2026-05-30');

    const blank = memoryStorage();
    blank.setItem(`${SAVE_PREFIX}progress`, JSON.stringify({ stats: { runs: 2 } }));
    expect(makeGame('crashy', {}, blank).store.progress().stats.firstDay).toBe('');
  });
});

/** A fake browser sender that records each send. */
function fakeSender(beaconOk = true): Sender & { beacons: string[]; fetches: RequestInit[] } {
  const beacons: string[] = [];
  const fetches: RequestInit[] = [];
  return {
    beacons,
    fetches,
    sendBeacon: (_url, body) => {
      beacons.push(body);
      return beaconOk;
    },
    fetch: (_url, init) => {
      fetches.push(init);
      return Promise.resolve();
    },
  };
}

const PH = { key: 'phc_projectkey123', endpoint: '/flurry' };
const at = () => new Date(Date.UTC(2026, 10, 14, 9, 30));
const ev = (n: number): AnalyticsEvent => ({ name: 'Run Started', data: { visit_run: String(n) } });

describe('PostHog tracker', () => {
  it("sends PostHog's batch format every 10 events, with the visit as the id and no person profile", () => {
    const sender = fakeSender();
    const t = startPostHog(PH, sender, 'v1sit', at);
    for (let i = 1; i < 10; i++) t.track(ev(i));
    expect(sender.beacons).toEqual([]);
    t.track(ev(10));
    expect(sender.beacons).toHaveLength(1);
    const body = JSON.parse(sender.beacons[0] ?? '') as BatchBody;
    expect(Object.keys(body)).toEqual(['api_key', 'batch']);
    expect(body.api_key).toBe('phc_projectkey123');
    expect(body.batch).toHaveLength(10);
    expect(body.batch[0]).toEqual({
      event: 'Run Started',
      distinct_id: 'v1sit',
      timestamp: '2026-11-14T09:30:00.000Z',
      properties: { visit_run: '1', $process_person_profile: false, $geoip_disable: true },
    });
  });

  it('sends what is waiting on flush, and nothing when nothing is', () => {
    const sender = fakeSender();
    const t = startPostHog(PH, sender, 'v', at);
    t.flush();
    expect(sender.beacons).toEqual([]);
    t.track(ev(1));
    t.flush();
    t.flush();
    expect(sender.beacons).toHaveLength(1);
  });

  it('falls back to a keep-alive fetch without cookies when the beacon is refused or missing', () => {
    const refused = fakeSender(false);
    const t = startPostHog(PH, refused, 'v', at);
    t.track(ev(1));
    t.flush();
    expect(refused.fetches).toHaveLength(1);
    expect(refused.fetches[0]).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
    });

    const fetches: RequestInit[] = [];
    const noBeacon = startPostHog(
      PH,
      { fetch: (_u, i) => (fetches.push(i), Promise.resolve()) },
      'v',
    );
    noBeacon.track(ev(1));
    noBeacon.flush();
    expect(fetches).toHaveLength(1);
  });

  it('never throws and drops what it cannot send', async () => {
    const broken: Sender = {
      sendBeacon: () => {
        throw new Error('beacon');
      },
      fetch: () => Promise.reject(new Error('offline')),
    };
    const t = startPostHog(PH, broken, 'v', at);
    expect(() => {
      for (let i = 0; i < 25; i++) t.track(ev(i));
      t.flush();
    }).not.toThrow();
    const nothing = startPostHog(PH, {}, 'v', () => {
      throw new Error('clock');
    });
    expect(() => nothing.track(ev(1))).not.toThrow();
    await Promise.resolve();
  });

  it('makes a fresh random visit id, and takes only a sound key and endpoint', () => {
    let n = 0;
    expect(visitId((b) => b.fill(171))).toBe('ab'.repeat(16));
    expect(visitId((b) => b.forEach((_, i) => (b[i] = n++)))).toMatch(/^[0-9a-f]{32}$/);
    expect(posthogConfig('phc_abc123def456', '/flurry')).toEqual({
      key: 'phc_abc123def456',
      endpoint: '/flurry',
    });
    expect(posthogConfig('phc_abc123def456', 'https://powline.vercel.app/flurry')).not.toBeNull();
    for (const [key, endpoint] of [
      ['', '/flurry'],
      ['sk_secret_abcdefgh', '/flurry'],
      ['phc_abc123def456', 'http://powline.vercel.app/flurry'],
      ['phc_abc123def456', '//evil.example/x'],
      ['phc_abc123def456', '/a/../b'],
      ['phc_abc123def456', '/flurry?x=1'],
    ] as const) {
      expect(posthogConfig(key, endpoint)).toBeNull();
    }
  });

  it('fans every event out to each tracker, even when one throws', () => {
    const seen: string[] = [];
    const t = fanOut(
      {
        track: () => {
          throw new Error('x');
        },
      },
      { track: (e) => seen.push(e.name) },
    );
    expect(() => t.track(ev(1))).not.toThrow();
    expect(seen).toEqual(['Run Started']);
  });
});

/** A request the ingest function can read. */
function req(method: string, body: string, headers: Record<string, string> = {}): BodyReq {
  return {
    method,
    headers,
    url: '/ingest',
    async *[Symbol.asyncIterator]() {
      // A chunk arrives later, as from a socket.
      yield await Promise.resolve(new TextEncoder().encode(body));
    },
  };
}

function res(): Res & { status: number } {
  const r = {
    status: 0,
    statusCode: 0,
    setHeader: () => {},
    end: () => {
      r.status = r.statusCode;
    },
  };
  return r;
}

const BATCH = {
  api_key: 'phc_projectkey123',
  batch: [
    {
      event: 'Run Ended',
      distinct_id: 'v1sit',
      timestamp: '2026-11-14T09:30:00.000Z',
      properties: {
        metres: '0-99',
        $ip: '203.0.113.9',
        $process_person_profile: true,
        nested: { seed: 'k1abc' },
        'Bad Name': 'x',
      },
    },
    { event: '', distinct_id: 'v1sit', properties: {} },
  ],
};

describe('ingest function', () => {
  it('rebuilds a batch from only what PostHog needs, with the privacy flags forced and a coarse country', () => {
    expect(cleanBatch(BATCH, 'phc_projectkey123', 'DE')).toEqual({
      api_key: 'phc_projectkey123',
      batch: [
        {
          event: 'Run Ended',
          distinct_id: 'v1sit',
          timestamp: '2026-11-14T09:30:00.000Z',
          properties: {
            metres: '0-99',
            country: 'DE',
            $process_person_profile: false,
            $geoip_disable: true,
          },
        },
      ],
    });
    expect(
      cleanBatch(BATCH, 'phc_projectkey123', 'not a country')?.batch[0]?.properties,
    ).not.toHaveProperty('country');
    expect(cleanBatch(BATCH, 'phc_other', null)).toBeNull();
    expect(cleanBatch(BATCH, '', null)).toBeNull();
    expect(
      cleanBatch({ api_key: 'phc_projectkey123', batch: 'x' }, 'phc_projectkey123', null),
    ).toBeNull();
  });

  it('forwards to PostHog with no header of the player, and answers with a bare status', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const deps = {
      key: 'phc_projectkey123',
      upstream: 'https://eu.i.posthog.com/',
      fetch: (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve({ ok: true });
      },
    };
    const r = res();
    await ingest(
      req('POST', JSON.stringify(BATCH), { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'UA' }),
      r,
      deps,
    );
    expect(r.status).toBe(204);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://eu.i.posthog.com/batch/');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    const sent = calls[0]?.init.body as string;
    expect(sent).not.toContain('203.0.113.9');
    expect(sent).not.toContain('k1abc');

    const statuses: number[] = [];
    for (const [method, body, d] of [
      ['GET', '', deps],
      ['POST', 'x'.repeat(INGEST_MAX_BYTES + 1), deps],
      ['POST', '{oops', deps],
      ['POST', JSON.stringify(BATCH), { ...deps, key: '' }],
      ['POST', JSON.stringify(BATCH), { ...deps, fetch: () => Promise.resolve({ ok: false }) }],
      ['POST', JSON.stringify(BATCH), { ...deps, fetch: () => Promise.reject(new Error('down')) }],
    ] as const) {
      const out = res();
      await ingest(req(method, body), out, d);
      statuses.push(out.status);
    }
    expect(statuses).toEqual([405, 413, 400, 204, 502, 502]);
    // Only the first request reached PostHog: no key means nothing is sent.
    expect(calls).toHaveLength(1);
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

  it("never reports a dare link's code, which carries the seed", () => {
    expect(cleanUrl('https://powline.vercel.app/c/k1abc-1240-312-4-3-t', true)).toBe(
      'https://powline.vercel.app/from-share',
    );
    expect(cleanUrl('https://powline.vercel.app/c/k1abc-1240-312-4-3-t/', false)).toBe(
      'https://powline.vercel.app/',
    );
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
