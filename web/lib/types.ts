export type Experiment = {
  id: string;
  name: string;
  tag: string;
  config: Record<string, unknown>;
  created_at: string;
};

export type Render = {
  id: string;
  experiment_id: string;
  request_id: string;
  media_url: string;
  media_type: "image" | "video";
  task_uuid: string | null;
  metadata: Record<string, unknown>;
  timings: Record<string, unknown>;
  created_at: string;
};

export type Vote = {
  id: string;
  experiment_a_id: string;
  experiment_b_id: string;
  request_id: string;
  voter_name: string;
  winner: "a" | "b" | "tie";
  created_at: string;
};

export type Battle = {
  id: string;
  name: string;
  description: string;
  created_at: string;
};

export type BattleExperiment = {
  battle_id: string;
  experiment_id: string;
};

/** Always returns [smaller, larger] so a pair of experiments has one canonical identity. */
export function canonicalPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Pulls http(s):// image URLs out of request metadata (keys mentioning "image", e.g. seedImage/referenceImages).
 * Values that aren't URLs (e.g. a local file path) are resolved by basename against
 * `bucketBasenameIndex` (basename -> public URL), if provided. */
export function extractImageUrls(
  metadata: Record<string, unknown>,
  bucketBasenameIndex?: Record<string, string>,
): string[] {
  const resolve = (v: unknown): string | null => {
    if (typeof v !== "string" || !v) return null;
    if (/^https?:\/\//.test(v)) return v;
    const basename = v.split(/[\\/]/).pop() ?? v;
    return bucketBasenameIndex?.[basename] ?? null;
  };
  const urls: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!/image/i.test(key)) continue;
    const direct = resolve(value);
    if (direct) {
      urls.push(direct);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const resolved = resolve(item);
        if (resolved) urls.push(resolved);
      }
    }
  }
  return urls;
}
