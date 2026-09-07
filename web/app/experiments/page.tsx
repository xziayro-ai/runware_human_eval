"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Experiment } from "@/lib/types";

type ExperimentWithCount = Experiment & { renders: { count: number }[] };

export default function ExperimentsPage() {
  const router = useRouter();
  const [experiments, setExperiments] = useState<ExperimentWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    supabase
      .from("experiments")
      .select("*, renders(count)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setExperiments((data as ExperimentWithCount[]) ?? []);
        setLoading(false);
      });
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const canCompare = selectedIds.length === 2;
  const canBrowse = selectedIds.length >= 2;

  return (
    <div>
      <h1>Experiments</h1>
      <p className="muted">
        All experiments, regardless of battle. Upload renders with the Python
        script (<code>scripts/upload_results.py</code>), then pick two
        experiments below to compare them ad hoc. Prefer{" "}
        <a href="/battles">battles →</a> for grouped random matchups and scoped
        Elo.
      </p>

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && experiments.length === 0 && (
        <p className="muted">No experiments yet. Upload some renders first.</p>
      )}

      {experiments.map((exp) => (
        <div className="card" key={exp.id}>
          <div className="row">
            <div>
              <h3>{exp.name}</h3>
              <div className="muted">
                tag: {exp.tag} · {exp.renders?.[0]?.count ?? 0} renders
              </div>
            </div>
          </div>
        </div>
      ))}

      {experiments.length >= 2 && (
        <div className="card">
          <h3>Start a comparison</h3>
          <p className="muted">
            Pick exactly 2 experiments to vote, or 2+ to just browse them side by side.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {experiments.map((e) => (
              <label
                key={e.id}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggleSelected(e.id)}
                />
                {e.name}
              </label>
            ))}
          </div>
          <div className="row" style={{ gap: 12, marginTop: 12, justifyContent: "flex-start" }}>
            <button
              className="btn"
              disabled={!canCompare}
              onClick={() => router.push(`/compare/${selectedIds[0]}/${selectedIds[1]}`)}
            >
              Compare →
            </button>
            <button
              className="btn secondary"
              disabled={!canBrowse}
              onClick={() => router.push(`/browse/${selectedIds.join("/")}`)}
            >
              Browse (no vote) →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
