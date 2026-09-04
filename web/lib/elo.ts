import type { Experiment, Vote } from "@/lib/types";

export const INITIAL_RATING = 1000;
export const K_FACTOR = 32;
// Bootstrap resamples: re-run Elo over a shuffled vote order many times to see how much
// the ranking could have moved by chance (same idea as lmsys chatbot-arena's CIs).
export const BOOTSTRAP_ITERATIONS = 200;

export type EloRow = {
  experiment: Experiment;
  rating: number;
  ciLow: number;
  ciHigh: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
};

/** Standard Elo update: expected score from ratings, then move each rating toward the actual result. */
function applyElo(
  ratings: Record<string, number>,
  aId: string,
  bId: string,
  scoreA: number,
) {
  const ra = ratings[aId];
  const rb = ratings[bId];
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  ratings[aId] = ra + K_FACTOR * (scoreA - expectedA);
  ratings[bId] = rb + K_FACTOR * (1 - scoreA - (1 - expectedA));
}

/** One full Elo pass over votes in the given order, starting every experiment at INITIAL_RATING. */
export function runElo(
  experimentIds: string[],
  votes: Vote[],
): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const id of experimentIds) ratings[id] = INITIAL_RATING;
  for (const vote of votes) {
    const { experiment_a_id: aId, experiment_b_id: bId, winner } = vote;
    if (!(aId in ratings) || !(bId in ratings)) continue; // experiment filtered/deleted
    const scoreA = winner === "a" ? 1 : winner === "b" ? 0 : 0.5;
    applyElo(ratings, aId, bId, scoreA);
  }
  return ratings;
}

function shuffled<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/**
 * Computes Elo ratings + bootstrap 95% CIs for a set of experiments, using only
 * the votes where BOTH sides are in that set (so experiments only "compete" against
 * others in the same group, e.g. the same battle or tag).
 */
export function computeEloRows(
  experiments: Experiment[],
  votes: Vote[],
): EloRow[] {
  const experimentIds = experiments.map((e) => e.id);
  const idSet = new Set(experimentIds);
  const filteredVotes = votes.filter(
    (v) => idSet.has(v.experiment_a_id) && idSet.has(v.experiment_b_id),
  );

  const games: Record<string, number> = {};
  const wins: Record<string, number> = {};
  const losses: Record<string, number> = {};
  const ties: Record<string, number> = {};
  for (const id of experimentIds) {
    games[id] = 0;
    wins[id] = 0;
    losses[id] = 0;
    ties[id] = 0;
  }
  for (const vote of filteredVotes) {
    const { experiment_a_id: aId, experiment_b_id: bId, winner } = vote;
    games[aId]++;
    games[bId]++;
    if (winner === "a") {
      wins[aId]++;
      losses[bId]++;
    } else if (winner === "b") {
      wins[bId]++;
      losses[aId]++;
    } else {
      ties[aId]++;
      ties[bId]++;
    }
  }

  // Point estimate: single pass in chronological order.
  const ratings = runElo(experimentIds, filteredVotes);

  // Confidence interval: bootstrap by re-running Elo over a shuffled vote order.
  const samples: Record<string, number[]> = {};
  for (const id of experimentIds) samples[id] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    const sampleRatings = runElo(experimentIds, shuffled(filteredVotes));
    for (const id of experimentIds) samples[id].push(sampleRatings[id]);
  }

  return experiments
    .map((experiment) => {
      const sorted = samples[experiment.id].slice().sort((a, b) => a - b);
      return {
        experiment,
        rating: ratings[experiment.id],
        ciLow: sorted.length
          ? percentile(sorted, 0.025)
          : ratings[experiment.id],
        ciHigh: sorted.length
          ? percentile(sorted, 0.975)
          : ratings[experiment.id],
        games: games[experiment.id],
        wins: wins[experiment.id],
        losses: losses[experiment.id],
        ties: ties[experiment.id],
      };
    })
    .sort((a, b) => b.rating - a.rating);
}
