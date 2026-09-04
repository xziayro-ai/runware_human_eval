"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Experiment } from "@/lib/types";

type ExperimentWithCount = Experiment & { renders: { count: number }[] };

export default function HomePage() {
  const router = useRouter();
  const [experiments, setExperiments] = useState<ExperimentWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedA, setSelectedA] = useState("");
  const [selectedB, setSelectedB] = useState("");

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

  const canCompare = selectedA && selectedB && selectedA !== selectedB;

  return (
    <div>
      <h1>Experiments</h1>
      <p className="muted">
        Upload renders with the Python script (
        <code>scripts/upload_results.py</code>), then pick two experiments below
        to start voting on human preferences. See the{" "}
        <a href="/leaderboard">Elo leaderboard →</a>.
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
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <select
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
            >
              <option value="">Experiment A…</option>
              {experiments.map((e) => (
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
              {experiments.map((e) => (
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
    </div>
  );
}
