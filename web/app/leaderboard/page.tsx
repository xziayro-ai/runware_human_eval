"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Experiment, Vote } from "@/lib/types";

const INITIAL_RATING = 1000;
const K_FACTOR = 32;
// Bootstrap resamples: re-run Elo over a shuffled vote order many times to see how much
// the ranking could have moved by chance (same idea as lmsys chatbot-arena's CIs).
const BOOTSTRAP_ITERATIONS = 200;

type Row = {
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
function runElo(
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

export default function LeaderboardPage() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [
        { data: experimentsData, error: errE },
        { data: votesData, error: errV },
      ] = await Promise.all([
        supabase.from("experiments").select("*"),
        supabase
          .from("votes")
          .select("*")
          .order("created_at", { ascending: true }),
      ]);
      if (errE || errV) {
        setError(errE?.message || errV?.message || "Failed to load");
        return;
      }
      setExperiments(experimentsData ?? []);
      setVotes((votesData ?? []) as Vote[]);
    })();
  }, []);

  const tags = useMemo(() => {
    if (!experiments) return [];
    return Array.from(
      new Set(experiments.map((e) => e.tag).filter(Boolean)),
    ).sort();
  }, [experiments]);

  const rows = useMemo<Row[] | null>(() => {
    if (!experiments || !votes) return null;

    const filteredExperiments =
      selectedTag === "all"
        ? experiments
        : experiments.filter((e) => e.tag === selectedTag);
    const experimentIds = filteredExperiments.map((e) => e.id);
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

    const result: Row[] = filteredExperiments
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
    return result;
  }, [experiments, votes, selectedTag]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Leaderboard</h1>
      <p className="muted">
        Elo rating computed from every vote across all experiment pairs (K=
        {K_FACTOR}, starting rating {INITIAL_RATING}). 95% CI from{" "}
        {BOOTSTRAP_ITERATIONS} bootstrap resamples of the vote order.
      </p>

      {tags.length > 0 && (
        <div
          className="row"
          style={{ marginBottom: 12, gap: 8, alignItems: "center" }}
        >
          <label className="muted" htmlFor="tag-filter">
            Tag:
          </label>
          <select
            id="tag-filter"
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
          >
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      )}

      <table className="results-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Experiment</th>
            <th>Elo</th>
            <th>95% CI</th>
            <th>Games</th>
            <th>W</th>
            <th>L</th>
            <th>T</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.experiment.id}>
              <td>{i + 1}</td>
              <td>{row.experiment.name}</td>
              <td>{Math.round(row.rating)}</td>
              <td className="muted">
                {Math.round(row.ciLow)}–{Math.round(row.ciHigh)}
              </td>
              <td>{row.games}</td>
              <td>{row.wins}</td>
              <td>{row.losses}</td>
              <td>{row.ties}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
