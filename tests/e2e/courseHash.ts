import { hashSeed } from '../../src/core/rng';
import { cruiseSpeed, maxFlightPx, topSpeed } from '../../src/sim/speed';
import { density, pathHalfWidth, Spawner } from '../../src/sim/spawner';

/** World pixels generated per seed: 7500 m at 8 px per metre. */
export const COURSE_PX = 60000;
/** The live game asks for a little more course at a time, so generate in chunks too. */
const CHUNK_PX = 2000;
/** How often the unrounded path and difficulty curves are sampled. */
const SAMPLE_PX = 64;

export interface CourseHash {
  seed: string;
  hash: string;
  objects: number;
}

/** FNV-1a over the exact bytes of every value, so a difference in the last bit of a double shows up. */
export class ExactHasher {
  private a = 0x811c9dc5;
  private b = 0x01000193;
  private readonly view = new DataView(new ArrayBuffer(8));

  private byte(v: number): void {
    this.a = Math.imul(this.a ^ v, 16777619);
    this.b = Math.imul(this.b ^ v, 1099511);
  }

  add(value: unknown): void {
    if (typeof value === 'number') {
      this.view.setFloat64(0, value);
      for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
    } else if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i) & 255);
    } else if (typeof value === 'boolean') {
      this.byte(value ? 1 : 2);
    } else if (value === null || value === undefined) {
      this.byte(3);
    } else if (Array.isArray(value)) {
      this.add(value.length);
      for (const v of value) this.add(v);
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        this.add(key);
        this.add(record[key]);
      }
    }
  }

  get hex(): string {
    return (
      (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0')
    );
  }
}

/** Hash one whole course, plus the unrounded floats that the rounded objects are placed from. */
export function hashCourse(seed: string, px = COURSE_PX): CourseHash {
  const spawner = new Spawner(hashSeed(seed));
  const hasher = new ExactHasher();
  let objects = 0;
  for (let y = CHUNK_PX; y <= px; y += CHUNK_PX) {
    const batch = spawner.advance(y);
    hasher.add(batch);
    for (const list of Object.values(batch)) if (Array.isArray(list)) objects += list.length;
  }
  for (let y = 0; y <= px; y += SAMPLE_PX) {
    const distM = y / 8;
    hasher.add(spawner.pathCenter(y));
    hasher.add(pathHalfWidth(distM));
    hasher.add(density(distM));
    hasher.add(cruiseSpeed(distM));
    hasher.add(topSpeed(distM));
    hasher.add(maxFlightPx(topSpeed(distM)));
  }
  return { seed, hash: hasher.hex, objects };
}

export function hashCourses(seeds: readonly string[]): CourseHash[] {
  return seeds.map((seed) => hashCourse(seed));
}
