const STORAGE_KEY = "human_eval_voter_name";
const CHANGE_EVENT = "voterNameChange";

/** Reads the voter's name from localStorage (null on the server or if unset). */
export function getVoterName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setVoterName(name: string) {
  window.localStorage.setItem(STORAGE_KEY, name.trim());
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearVoterName() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribes to voter name changes (same tab via CHANGE_EVENT, other tabs via storage). Returns an unsubscribe fn. */
export function onVoterNameChange(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
