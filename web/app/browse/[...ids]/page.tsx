"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { buildBucketBasenameIndex } from "@/lib/bucket";
import { extractImageUrls, naturalSort, type Experiment, type Render } from "@/lib/types";

type Props = { params: Promise<{ ids: string[] }> };

export default function BrowsePage({ params }: Props) {
  const { ids: rawIds } = use(params);
  // De-dupe while preserving the order the user picked them in.
  const ids = useMemo(() => Array.from(new Set(rawIds)), [rawIds]);

  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [rendersById, setRendersById] = useState<Record<
    string,
    Record<string, Render>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const [bucketIndex, setBucketIndex] = useState<Record<string, string>>({});

  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const readyRef = useRef<boolean[]>([]);
  const autoPlayedRef = useRef(false);
  const audioTimeoutsRef = useRef<number[]>([]);
  const [audioIndex, setAudioIndex] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: expData, error: errE }, ...renderResults] =
        await Promise.all([
          supabase.from("experiments").select("*").in("id", ids),
          ...ids.map((id) =>
            supabase.from("renders").select("*").eq("experiment_id", id),
          ),
        ]);
      const errR = renderResults.find((r) => r.error)?.error;
      if (errE || errR) {
        setError(errE?.message || errR?.message || "Failed to load");
        return;
      }
      const ordered = ids
        .map((id) => expData?.find((e) => e.id === id))
        .filter((e): e is Experiment => !!e);
      setExperiments(ordered);
      const byId: Record<string, Record<string, Render>> = {};
      ids.forEach((id, i) => {
        byId[id] = Object.fromEntries(
          (renderResults[i].data ?? []).map((r) => [r.request_id, r]),
        );
      });
      setRendersById(byId);
    })();
  }, [ids]);

  // Once experiments are known, index their storage folders (tags) so non-URL image
  // references in metadata can be resolved against the actual bucket contents.
  useEffect(() => {
    if (!experiments || experiments.length === 0) return;
    (async () => {
      setBucketIndex(await buildBucketBasenameIndex(experiments.map((e) => e.tag)));
    })();
  }, [experiments]);

  // Requests present in every one of the selected experiments' renders.
  const common = useMemo(() => {
    if (!rendersById || ids.length === 0) return [];
    const [firstId, ...restIds] = ids;
    return Object.keys(rendersById[firstId] ?? {})
      .filter((rid) => restIds.every((id) => rid in (rendersById[id] ?? {})))
      .sort(naturalSort);
  }, [rendersById, ids]);

  // Requests fetched async, so clamp in case index outran the (now known) list length.
  const safeIndex = Math.min(index, Math.max(common.length - 1, 0));
  const current = common[safeIndex];

  const currentRenders = useMemo(() => {
    if (!rendersById || !current) return null;
    return ids.map((id) => rendersById[id]?.[current]);
  }, [rendersById, ids, current]);

  const allVideo = useMemo(
    () =>
      currentRenders != null &&
      currentRenders.every((r) => r?.media_type === "video"),
    [currentRenders],
  );

  // All experiments share the same request, so metadata (prompt/reference images) should
  // match across panes; use whichever render has it first.
  const requestMetadata = useMemo(
    () => currentRenders?.find((r) => r?.metadata)?.metadata ?? {},
    [currentRenders],
  );
  const prompt =
    (requestMetadata.positivePrompt as string | undefined) ??
    (requestMetadata.prompt as string | undefined);
  const referenceImages = useMemo(
    () => extractImageUrls(requestMetadata, bucketIndex),
    [requestMetadata, bucketIndex],
  );

  useEffect(() => {
    setShowPrompt(false);
  }, [current]);

  // Aggregate timings/cost across every common request, for a global (not just pairwise) comparison.
  const globalStats = useMemo(() => {
    if (!rendersById || common.length === 0) return null;
    const avg = (id: string, key: string) => {
      const renders = rendersById[id] ?? {};
      const vals = common
        .map((rid) => renders[rid]?.timings?.[key] as number | undefined)
        .filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return ids.map((id) => ({
      e2e: avg(id, "e2e_t"),
      inf: avg(id, "inf_t"),
      cost: avg(id, "cost"),
    }));
  }, [rendersById, common, ids]);

  const clearAudioTimeouts = useCallback(() => {
    audioTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    audioTimeoutsRef.current = [];
  }, []);

  // Reset playback bookkeeping each time we move to a different request.
  useEffect(() => {
    readyRef.current = ids.map(() => false);
    autoPlayedRef.current = false;
    clearAudioTimeouts();
    setAudioIndex(null);
  }, [current, ids, clearAudioTimeouts]);

  useEffect(() => clearAudioTimeouts, [clearAudioTimeouts]);

  const playAll = useCallback(() => {
    const videos = videoRefs.current.filter(
      (v): v is HTMLVideoElement => v != null,
    );
    if (videos.length === 0) return;
    clearAudioTimeouts();
    setAudioIndex(null);
    videos.forEach((v) => {
      v.pause();
      v.muted = true;
      v.currentTime = 0;
    });
    Promise.all(videos.map((v) => v.play())).catch(() => {
      /* autoplay may require another user gesture, ignore */
    });
  }, [clearAudioTimeouts]);

  // Unmutes one pane at a time (muting the rest), then hands off to the next
  // one automatically, cycling through every pane once and then stopping.
  const unmuteIndex = useCallback(
    (playIndex: number) => {
      const videos = videoRefs.current;
      if (videos.length === 0) return;
      clearAudioTimeouts();

      videos.forEach((v, i) => {
        if (v) v.muted = i !== playIndex;
      });
      setAudioIndex(playIndex);

      const active = videos[playIndex];
      const durationMs =
        active && active.duration && isFinite(active.duration)
          ? active.duration * 1000
          : 4000;

      const nextIndex = playIndex + 1;
      audioTimeoutsRef.current.push(
        window.setTimeout(() => {
          if (nextIndex < videos.length) {
            unmuteIndex(nextIndex);
          } else {
            videos.forEach((v) => {
              if (v) v.muted = true;
            });
            setAudioIndex(null);
          }
        }, durationMs),
      );
    },
    [clearAudioTimeouts],
  );

  // Clicking always (re)starts the sequential tour from the pane after the
  // currently-playing one, or from the start if nothing is playing.
  const playSequentialAudio = useCallback(() => {
    const start = audioIndex == null ? 0 : (audioIndex + 1) % ids.length;
    unmuteIndex(start);
  }, [audioIndex, ids.length, unmuteIndex]);

  const onVideoReady = useCallback(
    (i: number) => {
      readyRef.current[i] = true;
      // canplaythrough can fire again after our own play()/seek(0), so only
      // auto-start once per request to avoid an infinite play/reset loop.
      if (!autoPlayedRef.current && readyRef.current.every(Boolean)) {
        autoPlayedRef.current = true;
        playAll();
      }
    },
    [playAll],
  );

  // Keep every pane paused/playing together, whichever one the user interacts with.
  const onVideoPause = useCallback((i: number) => {
    videoRefs.current.forEach((v, j) => {
      if (j !== i) v?.pause();
    });
  }, []);

  const onVideoPlay = useCallback((i: number) => {
    videoRefs.current.forEach((v, j) => {
      if (j !== i) v?.play().catch(() => {});
    });
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

  if (ids.length < 2)
    return <p style={{ color: "#ff6b6b" }}>Pick at least 2 experiments.</p>;
  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;
  if (!experiments || !rendersById)
    return <p className="muted">Loading…</p>;
  if (experiments.length !== ids.length)
    return <p style={{ color: "#ff6b6b" }}>One or more experiments were not found.</p>;
  if (common.length === 0) {
    return (
      <p className="muted">
        These experiments have no requests in common.
      </p>
    );
  }

  return (
    <div className="compare-page">
      <p className="progress">
        {safeIndex + 1} / {common.length} · request <b>{current}</b>
      </p>

      {(prompt || referenceImages.length > 0) && (
        <div
          className="row"
          style={{ justifyContent: "center", gap: 8, marginBottom: 12 }}
        >
          {prompt && (
            <button
              className="btn secondary"
              style={{ padding: "6px 10px", fontSize: 16 }}
              onClick={() => setShowPrompt((s) => !s)}
              aria-label="Show prompt"
              title="Show prompt"
            >
              📝
            </button>
          )}
          {referenceImages.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt="Reference input"
              title="Reference input image"
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                objectFit: "cover",
                border: "1px solid #262a35",
              }}
            />
          ))}
        </div>
      )}

      {showPrompt && prompt && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prompt}</p>
        </div>
      )}

      <div
        className="grid-n"
        style={{ gridTemplateColumns: `repeat(${experiments.length}, minmax(220px, 1fr))` }}
      >
        {experiments.map((exp, i) => (
          <Pane
            key={exp.id}
            label={exp.name}
            render={currentRenders?.[i]}
            videoRef={(el) => {
              videoRefs.current[i] = el;
            }}
            onReady={() => onVideoReady(i)}
            onPause={() => onVideoPause(i)}
            onPlay={() => onVideoPlay(i)}
          />
        ))}
      </div>

      {allVideo && (
        <div className="center" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={playAll}>
            🔁 Replay all
          </button>{" "}
          <button className="btn secondary" onClick={playSequentialAudio}>
            🔊 Compare sound (tour)
          </button>
          {audioIndex != null && (
            <p className="muted" style={{ marginTop: 6 }}>
              Playing {experiments[audioIndex]?.name} audio…
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
        <GlobalStats experiments={experiments} stats={globalStats} />
      )}
    </div>
  );
}

type Stats = { e2e: number | null; inf: number | null; cost: number | null };

function GlobalStats({
  experiments,
  stats,
}: {
  experiments: Experiment[];
  stats: Stats[];
}) {
  const rows: [string, "e2e" | "inf" | "cost", string][] = [
    ["e2e", "e2e", "s"],
    ["inference", "inf", "s"],
    ["cost", "cost", "$"],
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
            {experiments.map((e) => (
              <th key={e.id}>{e.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, unit]) => {
            // Lower is better for both timings (s) and cost ($).
            const values = stats.map((s) => s[key]);
            const known = values.filter((v): v is number => v != null);
            const min = known.length ? Math.min(...known) : null;
            return (
              <tr key={label}>
                <td>{label}</td>
                {values.map((v, i) => (
                  <td key={experiments[i].id}>
                    {fmt(v, unit)} {v != null && v === min ? "🏆" : ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
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
  render: Render | undefined;
  videoRef: (el: HTMLVideoElement | null) => void;
  onReady: () => void;
  onPause?: () => void;
  onPlay?: () => void;
}) {
  if (!render) {
    return (
      <div className="pane">
        <p className="muted" style={{ padding: 16 }}>
          No render for this request.
        </p>
      </div>
    );
  }
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
