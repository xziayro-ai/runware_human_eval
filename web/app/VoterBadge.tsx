"use client";

import { useEffect, useState } from "react";
import { getVoterName, onVoterNameChange, setVoterName } from "@/lib/voter";

/** Header widget: shows the current voter name and lets them change it from any page. */
export default function VoterBadge() {
  const [voterName, setVoterNameState] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    const sync = () => setVoterNameState(getVoterName());
    sync();
    return onVoterNameChange(sync);
  }, []);

  if (!voterName || editing) {
    return (
      <form
        className="row"
        style={{ gap: 6, width: "auto" }}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = input.trim();
          if (!trimmed) return;
          setVoterName(trimmed);
          setEditing(false);
        }}
      >
        <input
          autoFocus
          placeholder="Your name"
          value={input}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setInput(e.target.value)}
          style={{ padding: "5px 8px", fontSize: 13, width: 140 }}
        />
        <button
          className="btn"
          style={{ padding: "5px 12px", fontSize: 12 }}
          type="submit"
          disabled={!input.trim()}
        >
          Save
        </button>
      </form>
    );
  }

  return (
    <span className="muted" style={{ fontSize: 13 }}>
      voting as <b>{voterName}</b>{" "}
      <button
        className="btn secondary"
        style={{ padding: "2px 8px", fontSize: 12, marginLeft: 4 }}
        onClick={() => {
          setInput(voterName);
          setEditing(true);
        }}
      >
        edit name
      </button>
    </span>
  );
}
