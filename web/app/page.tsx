"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Battle, BattleExperiment } from "@/lib/types";

export default function HomePage() {
  const [battles, setBattles] = useState<Battle[] | null>(null);
  const [battleExperiments, setBattleExperiments] = useState<
    BattleExperiment[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [
        { data: battlesData, error: errBattles },
        { data: battleExperimentsData, error: errBE },
      ] = await Promise.all([
        supabase
          .from("battles")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("battle_experiments").select("*"),
      ]);
      if (errBattles || errBE) {
        setError(errBattles?.message || errBE?.message || "Failed to load");
        return;
      }
      setBattles(battlesData ?? []);
      setBattleExperiments(battleExperimentsData ?? []);
    })();
  }, []);

  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const be of battleExperiments ?? []) {
      counts[be.battle_id] = (counts[be.battle_id] ?? 0) + 1;
    }
    return counts;
  }, [battleExperiments]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!battles) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Pick a battle</h1>
      <p className="muted">
        A battle groups experiments so they only vote/Elo against each other.
        Pick one to start voting, browse, or see its leaderboard. See the{" "}
        <a href="/leaderboard">global leaderboard →</a> or{" "}
        <a href="/experiments">all experiments →</a> for ad hoc comparisons.
      </p>

      {battles.length === 0 && (
        <p className="muted">
          No battles yet. <a href="/battles">Create one →</a>
        </p>
      )}

      {battles.map((battle) => (
        <a
          key={battle.id}
          href={`/battles/${battle.id}`}
          style={{ textDecoration: "none" }}
        >
          <div className="card">
            <div className="row">
              <div>
                <h3>{battle.name}</h3>
                <div className="muted">
                  {memberCounts[battle.id] ?? 0} experiment(s)
                </div>
              </div>
              <span className="btn">Enter →</span>
            </div>
          </div>
        </a>
      ))}

      {battles.length > 0 && (
        <p className="muted">
          <a href="/battles">Manage battles / create a new one →</a>
        </p>
      )}
    </div>
  );
}
