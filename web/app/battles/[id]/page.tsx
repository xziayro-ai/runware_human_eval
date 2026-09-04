"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Battle, Experiment, Vote } from "@/lib/types";
import { computeEloRows, INITIAL_RATING, K_FACTOR, BOOTSTRAP_ITERATIONS } from "@/lib/elo";

type ExperimentWithCount = Experiment & { renders: { count: number }[] };
type Props = { params: Promise<{ id: string }> };

/** Deterministic JSON string (sorted keys) so two configs can be compared for equality. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Bookkeeping keys that vary per upload run but don't describe the generation
// config itself (e.g. the storage folder name) — ignored when matching configs.
const CONFIG_KEYS_IGNORED_FOR_MATCH = new Set(["prefix"]);

function configForMatch(experiment: Experiment): string {
  const entries = Object.entries(experiment.config).filter(
    ([key]) => !CONFIG_KEYS_IGNORED_FOR_MATCH.has(key),
  );
  return stableStringify(Object.fromEntries(entries));
}

export default function BattleDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();

  const [battle, setBattle] = useState<Battle | null>(null);
  const [members, setMembers] = useState<ExperimentWithCount[] | null>(null);
  const [allExperiments, setAllExperiments] = useState<
    ExperimentWithCount[] | null
  >(null);
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedA, setSelectedA] = useState("");
  const [selectedB, setSelectedB] = useState("");
  const [addingId, setAddingId] = useState("");

  const load = useCallback(async () => {
    const [
      { data: battleData, error: errBattle },
      { data: memberRows, error: errMembers },
      { data: experimentsData, error: errE },
      { data: votesData, error: errV },
    ] = await Promise.all([
      supabase.from("battles").select("*").eq("id", id).single(),
      supabase
        .from("battle_experiments")
        .select("experiment_id")
        .eq("battle_id", id),
      supabase.from("experiments").select("*, renders(count)"),
      supabase.from("votes").select("*"),
    ]);
    if (errBattle || errMembers || errE || errV) {
      setError(
        errBattle?.message || errMembers?.message || errE?.message || errV?.message || "",
      );
      return;
    }
    const memberIds = new Set((memberRows ?? []).map((r) => r.experiment_id));
    const experiments = (experimentsData as ExperimentWithCount[]) ?? [];
    setBattle(battleData);
    setAllExperiments(experiments);
    setMembers(experiments.filter((e) => memberIds.has(e.id)));
    setVotes((votesData ?? []) as Vote[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canCompare = selectedA && selectedB && selectedA !== selectedB;

  const eloRows = useMemo(() => {
    if (!members || !votes) return null;
    return computeEloRows(members, votes);
  }, [members, votes]);

  const addMember = async () => {
    if (!addingId) return;
    const { error: errInsert } = await supabase
      .from("battle_experiments")
      .insert({ battle_id: id, experiment_id: addingId });
    if (errInsert) {
      setError(errInsert.message);
      return;
    }
    setAddingId("");
    await load();
  };

  // Random matchup: only pair members that share the exact same config, so the
  // vote is always a fair apples-to-apples comparison (same resolution/settings/etc).
  const voteRandomly = () => {
    if (!members || members.length < 2) return;
    const groups = new Map<string, Experiment[]>();
    for (const member of members) {
      const key = configForMatch(member);
      const group = groups.get(key) ?? [];
      group.push(member);
      groups.set(key, group);
    }
    const eligibleGroups = Array.from(groups.values()).filter(
      (g) => g.length >= 2,
    );
    if (eligibleGroups.length === 0) {
      setError(
        "No two experiments in this battle share the exact same config — add matching experiments to enable random voting.",
      );
      return;
    }
    const group =
      eligibleGroups[Math.floor(Math.random() * eligibleGroups.length)];
    const shuffled = group.slice().sort(() => Math.random() - 0.5);
    const [a, b] = shuffled;
    router.push(`/compare/${a.id}/${b.id}`);
  };

  const availableToAdd = useMemo(() => {
    if (!allExperiments || !members) return [];
    const memberIds = new Set(members.map((m) => m.id));
    return allExperiments.filter((e) => !memberIds.has(e.id));
  }, [allExperiments, members]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!battle || !members) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>{battle.name}</h1>
      <p className="muted">
        <a href="/battles">← All battles</a>
      </p>

      <div className="card">
        <h3>Random vote</h3>
        <p className="muted">
          Picks two battle members with the exact same config at random and
          sends you to vote on them.
        </p>
        <button
          className="btn"
          disabled={members.length < 2}
          onClick={voteRandomly}
        >
          🎲 Random matchup →
        </button>
      </div>

      <div className="card">
        <h3>Members ({members.length})</h3>
        {members.length === 0 && (
          <p className="muted">No experiments in this battle yet.</p>
        )}
        {members.map((m) => (
          <div className="row" key={m.id} style={{ padding: "4px 0" }}>
            <div>
              {m.name}{" "}
              <span className="muted">
                ({m.renders?.[0]?.count ?? 0} renders)
              </span>
            </div>
          </div>
        ))}
        {availableToAdd.length > 0 && (
          <div className="row" style={{ gap: 12, marginTop: 12 }}>
            <select
              value={addingId}
              onChange={(e) => setAddingId(e.target.value)}
            >
              <option value="">Add experiment…</option>
              {availableToAdd.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button className="btn secondary" disabled={!addingId} onClick={addMember}>
              Add
            </button>
          </div>
        )}
      </div>

      {members.length >= 2 && (
        <div className="card">
          <h3>Pick a specific matchup</h3>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <select
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
            >
              <option value="">Experiment A…</option>
              {members.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="muted">vs</span>
            <select
              value={selectedB}
              onChange={(e) => setSelectedB(e.target.value)}
            >
              <option value="">Experiment B…</option>
              {members.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!canCompare}
              onClick={() => router.push(`/compare/${selectedA}/${selectedB}`)}
            >
              Compare →
            </button>
            <button
              className="btn secondary"
              disabled={!canCompare}
              onClick={() => router.push(`/browse/${selectedA}/${selectedB}`)}
            >
              Browse (no vote) →
            </button>
          </div>
        </div>
      )}

      {eloRows && eloRows.length > 0 && (
        <div className="card">
          <h3>Battle leaderboard</h3>
          <p className="muted">
            Elo from votes among this battle's members only (K={K_FACTOR},
            start {INITIAL_RATING}, {BOOTSTRAP_ITERATIONS} bootstrap resamples).
          </p>
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
              {eloRows.map((row, i) => (
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
      )}
    </div>
  );
}
