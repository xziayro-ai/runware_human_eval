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
