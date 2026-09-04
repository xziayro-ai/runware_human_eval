"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Battle, BattleExperiment, Experiment } from "@/lib/types";

type ExperimentWithCount = Experiment & { renders: { count: number }[] };

export default function BattlesPage() {
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [battleExperiments, setBattleExperiments] = useState<
    BattleExperiment[] | null
  >(null);
  const [experiments, setExperiments] = useState<ExperimentWithCount[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [
      { data: battlesData, error: errBattles },
      { data: battleExperimentsData, error: errBE },
      { data: experimentsData, error: errE },
    ] = await Promise.all([
      supabase.from("battles").select("*").order("created_at", {
        ascending: false,
      }),
      supabase.from("battle_experiments").select("*"),
      supabase.from("experiments").select("*, renders(count)"),
    ]);
    if (errBattles || errBE || errE) {
      setError(errBattles?.message || errBE?.message || errE?.message || "");
      return;
    }
    setBattles(battlesData ?? []);
    setBattleExperiments(battleExperimentsData ?? []);
    setExperiments((experimentsData as ExperimentWithCount[]) ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const be of battleExperiments ?? []) {
      counts[be.battle_id] = (counts[be.battle_id] ?? 0) + 1;
    }
    return counts;
  }, [battleExperiments]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createBattle = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    const { data, error: errInsert } = await supabase
      .from("battles")
      .insert({ name: trimmed })
      .select()
      .single();
    if (errInsert || !data) {
      setError(errInsert?.message ?? "Failed to create battle");
      setCreating(false);
      return;
    }
    if (selectedIds.size > 0) {
      const rows = Array.from(selectedIds).map((experiment_id) => ({
        battle_id: data.id,
        experiment_id,
      }));
      const { error: errLink } = await supabase
        .from("battle_experiments")
        .insert(rows);
      if (errLink) {
        setError(errLink.message);
        setCreating(false);
        return;
      }
    }
    setName("");
    setSelectedIds(new Set());
    setCreating(false);
    await load();
  };

  const deleteBattle = async (id: string) => {
    if (!window.confirm("Delete this battle? Its experiments are unaffected."))
      return;
    const { error: errDelete } = await supabase
      .from("battles")
      .delete()
      .eq("id", id);
    if (errDelete) {
      setError(errDelete.message);
      return;
    }
    await load();
  };

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!battles || !experiments) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Battles</h1>
      <p className="muted">
        A battle is a curated set of experiments that vote/Elo against each
        other. Group experiments into a battle to compare and rank only within
        that group. See the global <a href="/leaderboard">leaderboard →</a>.
      </p>

      {battles.length === 0 && (
        <p className="muted">No battles yet. Create one below.</p>
      )}

      {battles.map((battle) => (
        <div className="card" key={battle.id}>
          <div className="row">
            <div>
              <h3>
                <a href={`/battles/${battle.id}`}>{battle.name}</a>
              </h3>
              <div className="muted">
                {memberCounts[battle.id] ?? 0} experiment(s)
              </div>
            </div>
            <button
              className="btn secondary"
              onClick={() => deleteBattle(battle.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <h3>Create a battle</h3>
        <div className="row" style={{ gap: 12, marginBottom: 12 }}>
          <input
            placeholder="Battle name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        {experiments.length === 0 ? (
          <p className="muted">No experiments yet.</p>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <p className="muted" style={{ marginBottom: 6 }}>
              Pick experiments to include (optional, you can add more later):
            </p>
            {experiments.map((exp) => (
              <label
                key={exp.id}
                className="row"
                style={{
                  justifyContent: "flex-start",
                  gap: 8,
                  padding: "4px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(exp.id)}
                  onChange={() => toggleSelected(exp.id)}
                />
                {exp.name}{" "}
                <span className="muted">
                  ({exp.renders?.[0]?.count ?? 0} renders)
                </span>
              </label>
            ))}
          </div>
        )}
        <button
          className="btn"
          disabled={!name.trim() || creating}
          onClick={createBattle}
        >
          {creating ? "Creating…" : "Create battle"}
        </button>
      </div>
    </div>
  );
}
