"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  canonicalPair,
  naturalSort,
  type Experiment,
  type Render,
} from "@/lib/types";

type Props = { params: Promise<{ a: string; b: string }> };

export default function BrowsePage({ params }: Props) {
  const { a: urlA, b: urlB } = use(params);
  const [canonA, canonB] = useMemo(
    () => canonicalPair(urlA, urlB),
    [urlA, urlB],
  );

  const [expA, setExpA] = useState<Experiment | null>(null);
  const [expB, setExpB] = useState<Experiment | null>(null);
  const [rendersA, setRendersA] = useState<Record<string, Render> | null>(null);
  const [rendersB, setRendersB] = useState<Record<string, Render> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);
  const readyRef = useRef({ left: false, right: false });
  const autoPlayedRef = useRef(false);
  const audioTimeoutsRef = useRef<number[]>([]);
  const [audioSide, setAudioSide] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    (async () => {
      const [
        { data: experiments, error: errE },
        { data: dataA, error: errA },
        { data: dataB, error: errB },
      ] = await Promise.all([
        supabase.from("experiments").select("*").in("id", [canonA, canonB]),
        supabase.from("renders").select("*").eq("experiment_id", urlA),
        supabase.from("renders").select("*").eq("experiment_id", urlB),
      ]);
      if (errE || errA || errB) {
        setError(
          errE?.message || errA?.message || errB?.message || "Failed to load",
        );
        return;
      }
      setExpA(experiments?.find((e) => e.id === canonA) ?? null);
      setExpB(experiments?.find((e) => e.id === canonB) ?? null);
      setRendersA(
        Object.fromEntries((dataA ?? []).map((r) => [r.request_id, r])),
      );
      setRendersB(
        Object.fromEntries((dataB ?? []).map((r) => [r.request_id, r])),
      );
    })();
  }, [urlA, urlB, canonA, canonB]);

  const common = useMemo(() => {
    if (!rendersA || !rendersB) return [];
    return Object.keys(rendersA)
      .filter((id) => id in rendersB)
      .sort(naturalSort);
  }, [rendersA, rendersB]);

  // Requests fetched async, so clamp in case index outran the (now known) list length.
  const safeIndex = Math.min(index, Math.max(common.length - 1, 0));
  const current = common[safeIndex];

  // Aggregate timings/cost across every common request, for a global (not just 1:1) comparison.
  const globalStats = useMemo(() => {
    if (!rendersA || !rendersB || common.length === 0) return null;
    const avg = (renders: Record<string, Render>, key: string) => {
      const vals = common
        .map((id) => renders[id]?.timings?.[key] as number | undefined)
        .filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      e2eA: avg(rendersA, "e2e_t"),
      e2eB: avg(rendersB, "e2e_t"),
      infA: avg(rendersA, "inf_t"),
      infB: avg(rendersB, "inf_t"),
      costA: avg(rendersA, "cost"),
      costB: avg(rendersB, "cost"),
    };
  }, [rendersA, rendersB, common]);

  const clearAudioTimeouts = useCallback(() => {
    audioTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    audioTimeoutsRef.current = [];
  }, []);

  // Reset playback bookkeeping each time we move to a different request.
  useEffect(() => {
    readyRef.current = { left: false, right: false };
    autoPlayedRef.current = false;
    clearAudioTimeouts();
    setAudioSide(null);
  }, [current, clearAudioTimeouts]);

  useEffect(() => clearAudioTimeouts, [clearAudioTimeouts]);

  const playBoth = useCallback(() => {
    const left = leftVideoRef.current;
    const right = rightVideoRef.current;
    if (!left || !right) return;
    clearAudioTimeouts();
    setAudioSide(null);
    left.pause();
    right.pause();
    left.muted = true;
    right.muted = true;
    left.currentTime = 0;
    right.currentTime = 0;
    Promise.all([left.play(), right.play()]).catch(() => {
      /* autoplay may require another user gesture, ignore */
    });
  }, [clearAudioTimeouts]);

  // Unmutes one side (muting the other), scheduling the automatic hand-off/stop.
  // Both videos just keep playing/looping in sync throughout — only .muted toggles.
  const unmuteSide = useCallback(
    (side: "left" | "right") => {
      const left = leftVideoRef.current;
      const right = rightVideoRef.current;
      if (!left || !right) return;
      clearAudioTimeouts();

      const durationMs = (el: HTMLVideoElement) =>
        el.duration && isFinite(el.duration) ? el.duration * 1000 : 4000;

      if (side === "left") {
        left.muted = false;
        right.muted = true;
        setAudioSide("left");
        audioTimeoutsRef.current.push(
          window.setTimeout(() => unmuteSide("right"), durationMs(left)),
        );
      } else {
        left.muted = true;
        right.muted = false;
        setAudioSide("right");
        audioTimeoutsRef.current.push(
          window.setTimeout(() => {
            right.muted = true;
            setAudioSide(null);
          }, durationMs(right)),
        );
      }
    },
    [clearAudioTimeouts],
  );

  // Clicking the button always switches sides immediately, even mid-playback
  // (i.e. while "Playing left/right audio…" is showing), instead of just
  // restarting the same left → right sequence from the top.
  const playSequentialAudio = useCallback(() => {
    unmuteSide(audioSide === "left" ? "right" : "left");
  }, [audioSide, unmuteSide]);

  const onVideoReady = useCallback(
    (side: "left" | "right") => {
      readyRef.current[side] = true;
      // canplaythrough can fire again after our own play()/seek(0), so only
      // auto-start once per request to avoid an infinite play/reset loop.
      if (
        readyRef.current.left &&
        readyRef.current.right &&
        !autoPlayedRef.current
      ) {
        autoPlayedRef.current = true;
        playBoth();
      }
    },
    [playBoth],
  );

  // Keep both sides paused/playing together, whichever one the user interacts with.
  const onVideoPause = useCallback((side: "left" | "right") => {
    const other =
      side === "left" ? rightVideoRef.current : leftVideoRef.current;
    other?.pause();
  }, []);

  const onVideoPlay = useCallback((side: "left" | "right") => {
    const other =
      side === "left" ? rightVideoRef.current : leftVideoRef.current;
    other?.play().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === "ArrowRight")
        setIndex((i) => Math.min(i + 1, common.length - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [common.length]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!expA || !expB || !rendersA || !rendersB)
    return <p className="muted">Loading…</p>;
  if (common.length === 0) {
    return (
      <p className="muted">These two experiments have no requests in common.</p>
    );
  }

  const renderA = rendersA[current];
  const renderB = rendersB[current];
  const bothVideo =
    renderA.media_type === "video" && renderB.media_type === "video";

  return (
    <div className="compare-page">
      <p className="progress">
        {safeIndex + 1} / {common.length} · request <b>{current}</b> ·{" "}
        <a href={`/compare/${canonA}/${canonB}`}>Vote instead →</a>
      </p>

      <div className="grid-2">
        <Pane
          label={expA.name}
          render={renderA}
          videoRef={leftVideoRef}
          onReady={() => onVideoReady("left")}
          onPause={() => onVideoPause("left")}
          onPlay={() => onVideoPlay("left")}
        />
        <Pane
          label={expB.name}
          render={renderB}
          videoRef={rightVideoRef}
          onReady={() => onVideoReady("right")}
          onPause={() => onVideoPause("right")}
          onPlay={() => onVideoPlay("right")}
        />
      </div>

      {bothVideo && (
        <div className="center" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={playBoth}>
            🔁 Replay both
          </button>{" "}
          <button className="btn secondary" onClick={playSequentialAudio}>
            🔊 Compare sound (L → R)
          </button>
          {audioSide && (
            <p className="muted" style={{ marginTop: 6 }}>
              Playing {audioSide} audio…
            </p>
          )}
        </div>
      )}

      <div className="center" style={{ marginTop: 12 }}>
        <button
          className="btn secondary"
          disabled={safeIndex === 0}
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
        >
          ← Prev
        </button>{" "}
        <button
          className="btn secondary"
          disabled={safeIndex >= common.length - 1}
          onClick={() => setIndex((i) => Math.min(i + 1, common.length - 1))}
        >
          Next →
        </button>
      </div>

      {globalStats && (
        <GlobalStats nameA={expA.name} nameB={expB.name} stats={globalStats} />
      )}
    </div>
  );
}

type Stats = {
  e2eA: number | null;
  e2eB: number | null;
  infA: number | null;
  infB: number | null;
  costA: number | null;
  costB: number | null;
};

/** Ratio > 1 means A is slower/more expensive than B; formatted as "B is N% faster/cheaper". */
function ratioLabel(
  a: number | null,
  b: number | null,
  nameA: string,
  nameB: string,
  noun: string,
) {
  if (a == null || b == null || a === 0 || b === 0) return null;
  const [fasterName, slowerName, ratio] =
    a > b ? [nameB, nameA, a / b] : [nameA, nameB, b / a];
  const pct = ((ratio - 1) * 100).toFixed(1);
  return `${fasterName} is ${ratio.toFixed(3)}× (${pct}%) ${noun} than ${slowerName}`;
}

function GlobalStats({
  nameA,
  nameB,
  stats,
}: {
  nameA: string;
  nameB: string;
  stats: Stats;
}) {
  const rows: [string, number | null, number | null, string][] = [
    ["e2e", stats.e2eA, stats.e2eB, "s"],
    ["inference", stats.infA, stats.infB, "s"],
    ["cost", stats.costA, stats.costB, "$"],
  ];
  const fmt = (v: number | null, unit: string) =>
    v == null
      ? "—"
      : unit === "$"
        ? `$${v.toFixed(4)}`
        : `${v.toFixed(2)}${unit}`;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Global averages</h3>
      <table className="results-table compact">
        <thead>
          <tr>
            <th></th>
            <th>{nameA}</th>
            <th>{nameB}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, unit]) => {
            // Lower is better for both timings (s) and cost ($).
            const winner =
              a != null && b != null && a !== b ? (a < b ? "a" : "b") : null;
            return (
              <tr key={label}>
                <td>{label}</td>
                <td>
                  {fmt(a, unit)} {winner === "a" ? "🏆" : ""}
                </td>
                <td>
                  {fmt(b, unit)} {winner === "b" ? "🏆" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        {ratioLabel(stats.infA, stats.infB, nameA, nameB, "faster") ??
          "Not enough timing data for a speed comparison."}
        <br />
        {ratioLabel(stats.costA, stats.costB, nameA, nameB, "cheaper") ??
          "Not enough cost data for a cost comparison."}
      </p>
    </div>
  );
}

function Pane({
  label,
  render,
  videoRef,
  onReady,
  onPause,
  onPlay,
}: {
  label: string;
  render: Render;
  videoRef: RefObject<HTMLVideoElement | null>;
  onReady: () => void;
  onPause?: () => void;
  onPlay?: () => void;
}) {
  return (
    <div className="pane">
      {render.media_type === "video" ? (
        <video
          ref={videoRef}
          src={render.media_url}
          controls
          loop
          muted
          playsInline
          onCanPlayThrough={onReady}
          onPause={onPause}
          onPlay={onPlay}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={render.media_url} alt={`Render ${label}`} />
      )}
      <p style={{ marginTop: 6, marginBottom: 0, fontWeight: 600 }}>{label}</p>
      <TimingInfo timings={render.timings} />
    </div>
  );
}

/** Timings are recorded by ml-api-requester as e2e_t/inf_t (seconds), cost (USD), ngpu. */
function TimingInfo({ timings }: { timings: Record<string, unknown> }) {
  const e2e = timings?.e2e_t as number | undefined;
  const inf = timings?.inf_t as number | undefined;
  const cost = timings?.cost as number | undefined;
  const ngpu = timings?.ngpu as number | undefined;
  if (e2e == null && inf == null && cost == null) return null;

  const parts: string[] = [];
  if (e2e != null) parts.push(`e2e ${e2e.toFixed(2)}s`);
  if (inf != null) parts.push(`inf ${inf.toFixed(2)}s`);
  if (ngpu != null) parts.push(`${ngpu} GPU`);
  if (cost != null) parts.push(`$${cost.toFixed(4)}`);

  return (
    <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
      {parts.join(" · ")}
    </p>
  );
}
