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
import { canonicalPair, naturalSort, type Render } from "@/lib/types";
import { getVoterName, onVoterNameChange } from "@/lib/voter";

type Props = { params: Promise<{ a: string; b: string }> };

export default function ComparePage({ params }: Props) {
  const { a: urlA, b: urlB } = use(params);
  const [canonA, canonB] = useMemo(
    () => canonicalPair(urlA, urlB),
    [urlA, urlB],
  );

  const [voterName, setVoterNameState] = useState<string | null>(null);
  const [rendersA, setRendersA] = useState<Record<string, Render> | null>(null);
  const [rendersB, setRendersB] = useState<Record<string, Render> | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [leftIsA, setLeftIsA] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);
  const readyRef = useRef({ left: false, right: false });
  const autoPlayedRef = useRef(false);
  const audioTimeoutsRef = useRef<number[]>([]);
  const [audioSide, setAudioSide] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    const sync = () => setVoterNameState(getVoterName());
    sync();
    return onVoterNameChange(sync);
  }, []);

  const load = useCallback(async () => {
    if (!voterName) return;
    const [
      { data: dataA, error: errA },
      { data: dataB, error: errB },
      { data: votes, error: errV },
    ] = await Promise.all([
      supabase.from("renders").select("*").eq("experiment_id", urlA),
      supabase.from("renders").select("*").eq("experiment_id", urlB),
      supabase
        .from("votes")
        .select("request_id")
        .eq("experiment_a_id", canonA)
        .eq("experiment_b_id", canonB)
        .eq("voter_name", voterName),
    ]);
    if (errA || errB || errV) {
      setError(
        errA?.message || errB?.message || errV?.message || "Failed to load",
      );
      return;
    }
    setRendersA(
      Object.fromEntries((dataA ?? []).map((r) => [r.request_id, r])),
    );
    setRendersB(
      Object.fromEntries((dataB ?? []).map((r) => [r.request_id, r])),
    );
    setVotedIds(new Set((votes ?? []).map((v) => v.request_id)));
  }, [urlA, urlB, canonA, canonB, voterName]);

  useEffect(() => {
    load();
  }, [load]);

  const common = useMemo(() => {
    if (!rendersA || !rendersB) return [];
    return Object.keys(rendersA)
      .filter((id) => id in rendersB)
      .sort(naturalSort);
  }, [rendersA, rendersB]);

  const remaining = useMemo(
    () => common.filter((id) => !votedIds.has(id)),
    [common, votedIds],
  );
  const current = remaining[0];

  const clearAudioTimeouts = useCallback(() => {
    audioTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    audioTimeoutsRef.current = [];
  }, []);

  // Randomize left/right placement each time we move to a new request.
  useEffect(() => {
    readyRef.current = { left: false, right: false };
    autoPlayedRef.current = false;
    setLeftIsA(Math.random() < 0.5);
    setShowPrompt(false);
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
    const other = side === "left" ? rightVideoRef.current : leftVideoRef.current;
    other?.pause();
  }, []);

  const onVideoPlay = useCallback((side: "left" | "right") => {
    const other = side === "left" ? rightVideoRef.current : leftVideoRef.current;
    other?.play().catch(() => {});
  }, []);

  const resetVotes = useCallback(async () => {
    if (!voterName) return;
    const confirmed = window.confirm(
      `Delete all of ${voterName}'s votes for this pair? This cannot be undone.`,
    );
    if (!confirmed) return;
    const { error } = await supabase
      .from("votes")
      .delete()
      .eq("experiment_a_id", canonA)
      .eq("experiment_b_id", canonB)
      .eq("voter_name", voterName);
    if (error) {
      setError(error.message);
      return;
    }
    setVotedIds(new Set());
  }, [voterName, canonA, canonB]);

  // Positions don't depend on the renders being loaded, so this can be computed
  // (and used by vote + keyboard shortcuts) before the early returns below.
  const leftExperimentId = leftIsA ? urlA : urlB;
  const rightExperimentId = leftIsA ? urlB : urlA;
  const winnerFor = (experimentId: string): "a" | "b" =>
    experimentId === canonA ? "a" : "b";

  const vote = useCallback(
    async (choice: "left" | "right" | "tie") => {
      if (submitting || !voterName || !current) return;
      setSubmitting(true);
      const winner =
        choice === "tie"
          ? "tie"
          : winnerFor(choice === "left" ? leftExperimentId : rightExperimentId);
      const { error } = await supabase.from("votes").upsert(
        {
          experiment_a_id: canonA,
          experiment_b_id: canonB,
          request_id: current,
          voter_name: voterName,
          winner,
        },
        { onConflict: "experiment_a_id,experiment_b_id,request_id,voter_name" },
      );
      setSubmitting(false);
      if (error) {
        setError(error.message);
        return;
      }
      setVotedIds((prev) => new Set(prev).add(current));
    },
    [
      submitting,
      voterName,
      current,
      leftExperimentId,
      rightExperimentId,
      canonA,
      canonB,
    ],
  );

  // Keyboard shortcuts: left/right arrows pick a side, up/down arrows vote a tie.
  // Capture phase + preventDefault so a focused <video> doesn't hijack arrow keys to seek.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        vote("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        vote("right");
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        vote("tie");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [vote]);

  if (error) return <p style={{ color: "#ff6b6b" }}>{error}</p>;

  if (!voterName) {
    return (
      <p className="muted center">
        Enter your name in the header above to start voting.
      </p>
    );
  }

  if (!rendersA || !rendersB) return <p className="muted">Loading…</p>;

  if (common.length === 0) {
    return (
      <p className="muted">These two experiments have no requests in common.</p>
    );
  }

  if (!current) {
    return (
      <div className="card center">
        <h2>All {common.length} requests voted ✅</h2>
        <a href={`/results/${canonA}/${canonB}`}>
          <button className="btn">See results →</button>
        </a>{" "}
        <button className="btn secondary" onClick={resetVotes}>
          Reset my votes
        </button>
      </div>
    );
  }

  const leftRender = leftIsA ? rendersA[current] : rendersB[current];
  const rightRender = leftIsA ? rendersB[current] : rendersA[current];
  const bothVideo =
    leftRender.media_type === "video" && rightRender.media_type === "video";

  // Same request_id should carry the same prompt/config on both sides; A is the reference.
  const requestMetadata =
    rendersA[current]?.metadata ?? rendersB[current]?.metadata ?? {};
  const prompt =
    (requestMetadata.positivePrompt as string | undefined) ??
    (requestMetadata.prompt as string | undefined);
  const referenceImages = extractImageUrls(requestMetadata);

  return (
    <div className="compare-page">
      <p className="progress">
        {common.length - remaining.length} / {common.length} voted · request{" "}
        <b>{current}</b> ·{" "}
        <a href={`/results/${canonA}/${canonB}`}>See results →</a> ·{" "}
        <button
          className="btn secondary"
          style={{ padding: "2px 8px", fontSize: 13 }}
          onClick={resetVotes}
        >
          Reset my votes
        </button>
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

      <div className="grid-2">
        <Pane
          label="Left"
          render={leftRender}
          videoRef={leftVideoRef}
          onReady={() => onVideoReady("left")}
          onPause={() => onVideoPause("left")}
          onPlay={() => onVideoPlay("left")}
        />
        <Pane
          label="Right"
          render={rightRender}
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

      <div className="vote-bar">
        <button
          className="btn arrow-btn"
          disabled={submitting}
          onClick={() => vote("left")}
          aria-label="Left is better"
          title="Left is better (←)"
        >
          ←
        </button>
        <button
          className="btn secondary arrow-btn"
          disabled={submitting}
          onClick={() => vote("tie")}
          aria-label="Tie"
          title="Tie (↑/↓)"
        >
          ↕
        </button>
        <button
          className="btn arrow-btn"
          disabled={submitting}
          onClick={() => vote("right")}
          aria-label="Right is better"
          title="Right is better (→)"
        >
          →
        </button>
      </div>
    </div>
  );
}

/** Pulls https:// image URLs out of request metadata (keys mentioning "image", e.g. seedImage/referenceImages). */
function extractImageUrls(metadata: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!/image/i.test(key)) continue;
    if (typeof value === "string" && value.startsWith("https://")) {
      urls.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.startsWith("https://"))
          urls.push(item);
      }
    }
  }
  return urls;
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
    </div>
  );
}
