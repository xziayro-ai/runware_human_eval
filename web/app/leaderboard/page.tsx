"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Battle, BattleExperiment, Experiment, Vote } from "@/lib/types";
import {
  computeEloRows,
  INITIAL_RATING,
  K_FACTOR,
  BOOTSTRAP_ITERATIONS,
  type EloRow,
} from "@/lib/elo";

export default function LeaderboardPage() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [battleExperiments, setBattleExperiments] = useState<
    BattleExperiment[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedBattle, setSelectedBattle] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [
        { data: experimentsData, error: errE },
        { data: votesData, error: errV },
        { data: battlesData, error: errB },
        { data: battleExperimentsData, error: errBE },
      ] = await Promise.all([
        supabase.from("experiments").select("*"),
        supabase
          .from("votes")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase.from("battles").select("*").order("name"),
        supabase.from("battle_experiments").select("*"),
      ]);
      if (errE || errV || errB || errBE) {
        setError(
          errE?.message ||
            errV?.message ||
            errB?.message ||
            errBE?.message ||
            "Failed to load",
        );
        return;
      }
      setExperiments(experimentsData ?? []);
      setVotes((votesData ?? []) as Vote[]);
      setBattles(battlesData ?? []);
      setBattleExperiments(battleExperimentsData ?? []);
    })();
  }, []);

  const tags = useMemo(() => {
    if (!experiments) return [];
    return Array.from(
      new Set(experiments.map((e) => e.tag).filter(Boolean)),
    ).sort();
  }, [experiments]);

  const rows = useMemo<EloRow[] | null>(() => {
    if (!experiments || !votes || !battleExperiments) return null;

    let filteredExperiments = experiments;
    if (selectedBattle !== "all") {
      const memberIds = new Set(
        battleExperiments
          .filter((be) => be.battle_id === selectedBattle)
          .map((be) => be.experiment_id),
      );
      filteredExperiments = filteredExperiments.filter((e) =>
        memberIds.has(e.id),
      );
    }
    if (selectedTag !== "all") {
      filteredExperiments = filteredExperiments.filter(
        (e) => e.tag === selectedTag,
      );
    }
    return computeEloRows(filteredExperiments, votes);
  }, [experiments, votes, battleExperiments, selectedTag, selectedBattle]);

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

      <div
        className="row"
        style={{
          marginBottom: 12,
          gap: 16,
          justifyContent: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {battles && battles.length > 0 && (
          <div className="row" style={{ gap: 8, width: "auto" }}>
            <label className="muted" htmlFor="battle-filter">
              Battle:
            </label>
            <select
              id="battle-filter"
              value={selectedBattle}
              onChange={(e) => setSelectedBattle(e.target.value)}
            >
              <option value="all">All battles</option>
              {battles.map((battle) => (
                <option key={battle.id} value={battle.id}>
                  {battle.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {tags.length > 0 && (
          <div className="row" style={{ gap: 8, width: "auto" }}>
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
      </div>

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
