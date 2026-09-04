"use client";

import { use, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { canonicalPair, type Experiment, type Vote } from "@/lib/types";

type Props = { params: Promise<{ a: string; b: string }> };

export default function ResultsPage({ params }: Props) {
  const { a: urlA, b: urlB } = use(params);
  const [canonA, canonB] = useMemo(
    () => canonicalPair(urlA, urlB),
    [urlA, urlB],
  );

  const [expA, setExpA] = useState<Experiment | null>(null);
  const [expB, setExpB] = useState<Experiment | null>(null);
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: experiments, error: errE }, { data: v, error: errV }] =
        await Promise.all([
          supabase.from("experiments").select("*").in("id", [canonA, canonB]),
          supabase
            .from("votes")
            .select("*")
            .eq("experiment_a_id", canonA)
            .eq("experiment_b_id", canonB),
        ]);
      if (errE || errV) {
        setError(errE?.message || errV?.message || "Failed to load");
        return;
      }
      setExpA(experiments?.find((e) => e.id === canonA) ?? null);
      setExpB(experiments?.find((e) => e.id === canonB) ?? null);
      setVotes(v ?? []);
    })();
  }, [canonA, canonB]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!expA || !expB || !votes) return <p className="muted">Loading…</p>;

  const total = votes.length;
  const aWins = votes.filter((v) => v.winner === "a").length;
  const bWins = votes.filter((v) => v.winner === "b").length;
  const ties = votes.filter((v) => v.winner === "tie").length;
  const pct = (n: number) =>
    total ? `${((n / total) * 100).toFixed(1)}%` : "—";

  const aPct = total ? (aWins / total) * 100 : 0;
  const bPct = total ? (bWins / total) * 100 : 0;
  const tiePct = total ? (ties / total) * 100 : 0;

  // A side only counts as the winner once it's ahead by at least this many
  // percentage points of BOTH the other side's share and the tie share;
  // otherwise call it a tie.
  const WIN_MARGIN = 10;
  const verdict = !total
    ? null
    : aPct - bPct >= WIN_MARGIN && aPct - tiePct >= WIN_MARGIN
      ? { label: `🏆 ${expA.name} wins`, tie: false }
      : bPct - aPct >= WIN_MARGIN && bPct - tiePct >= WIN_MARGIN
        ? { label: `🏆 ${expB.name} wins`, tie: false }
        : { label: "🤝 Tie", tie: true };

  const voterCounts = votes.reduce<Record<string, number>>((acc, v) => {
    acc[v.voter_name] = (acc[v.voter_name] ?? 0) + 1;
    return acc;
  }, {});
  const voterNames = Object.keys(voterCounts).sort();

  const COLOR_A = "var(--rw-green)";
  const COLOR_B = "#1f5c47";
  const COLOR_TIE = "#5f7266";
  const pieGradient = total
    ? `conic-gradient(${COLOR_A} 0% ${aPct}%, ${COLOR_B} ${aPct}% ${aPct + bPct}%, ${COLOR_TIE} ${aPct + bPct}% 100%)`
    : "#262a35";

  return (
    <div style={{ textAlign: "center" }}>
      <h1>Results</h1>

      {verdict && (
        <h2 style={{ color: verdict.tie ? COLOR_TIE : "var(--rw-green)" }}>
          {verdict.label}
        </h2>
      )}

      <div
        className="row"
        style={{
          alignItems: "flex-start",
          gap: 32,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "left" }}>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: pieGradient,
              margin: "0 auto",
            }}
          />
          <div style={{ marginTop: 14 }}>
            <LegendItem
              color={COLOR_A}
              label={expA.name}
              value={`${aWins} · ${pct(aWins)}`}
            />
            <LegendItem
              color={COLOR_B}
              label={expB.name}
              value={`${bWins} · ${pct(bWins)}`}
            />
            <LegendItem
              color={COLOR_TIE}
              label="Tie"
              value={`${ties} · ${pct(ties)}`}
            />
          </div>
        </div>

        {voterNames.length > 0 && (
          <div style={{ minWidth: 200, textAlign: "left" }}>
            <h3 style={{ marginTop: 0 }}>Voters</h3>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: "#9aa0ac",
                fontSize: 13,
              }}
            >
              {voterNames.map((name) => (
                <li key={name}>
                  {name}: {voterCounts[name]} votes
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="muted">
        {total} votes collected from {voterNames.length} voter
        {voterNames.length === 1 ? "" : "s"}
      </p>

      <table className="results-table">
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Wins</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{expA.name}</td>
            <td>{aWins}</td>
            <td>{pct(aWins)}</td>
          </tr>
          <tr>
            <td>{expB.name}</td>
            <td>{bWins}</td>
            <td>{pct(bWins)}</td>
          </tr>
          <tr>
            <td>Ties</td>
            <td>{ties}</td>
            <td>{pct(ties)}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 20 }}>
        <a href={`/compare/${canonA}/${canonB}`}>
          <button className="btn secondary">← Back to voting</button>
        </a>
      </p>
    </div>
  );
}

function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div
      className="row"
      style={{ gap: 8, marginBottom: 4, justifyContent: "flex-start" }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13 }}>
        {label}: <b>{value}</b>
      </span>
    </div>
  );
}
