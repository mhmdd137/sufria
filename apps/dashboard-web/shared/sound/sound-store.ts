/**
 * The dashboard's alert sound, apart from React and from the audio itself
 * (brief م-ب, decisions 5 and 9): whether it is muted on this device, whether
 * the browser stopped it, and the one call that rings. The audio — Web Audio,
 * no file — is `player.ts`, loaded with `import()` the first time something
 * must ring: no page waits for it, and before that this file and the button
 * and strip are all a page carries.
 */

/** The two sounds: O2 for a new order, M1 for a customer's message. */
export type SoundKind = "order" | "message";

/** What `player.ts` does — a fake one in the tests. */
export type Player = {
  /** Rings `kind`; `false` when the browser keeps the audio stopped. */
  play(kind: SoundKind): Promise<boolean>;
  /** Asks the browser to run the audio; `true` once it does. */
  resume(): Promise<boolean>;
};

export type SoundState = {
  /** «اكتم الصوت» on this device (`localStorage`). */
  muted: boolean;
  /** A sound was due and the browser kept the audio stopped. */
  blocked: boolean;
};

/** Which strip shows under the header: «مكتوم» wins over the browser's. */
export type SoundStrip = "muted" | "blocked" | null;

export function soundStrip(state: SoundState): SoundStrip {
  if (state.muted) return "muted";
  return state.blocked ? "blocked" : null;
}

export const MUTED_KEY = "sufria.sound.muted";

/**
 * Every read and write of the key in `try`: storage can be missing, or throw
 * (a private window, blocked site data). Not muted, then — the default.
 */
export function readMuted(storage: () => Storage | undefined): boolean {
  try {
    return storage()?.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(storage: () => Storage | undefined, muted: boolean): void {
  try {
    const s = storage();
    if (muted) s?.setItem(MUTED_KEY, "1");
    else s?.removeItem(MUTED_KEY);
  } catch {
    // The choice holds for this page; the next one starts unmuted.
  }
}

export type SoundStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SoundState;
  setMuted(muted: boolean): void;
  /** Rings `kind`, unless muted; a stopped browser shows its strip. */
  alert(kind: SoundKind): Promise<void>;
  /** «شغّل الصوت»: unmuted, the audio asked to run — and what was due rings. */
  enable(): Promise<void>;
  /** The browser runs the audio now (a press anywhere): its strip goes. */
  running(): void;
};

export function createSoundStore({
  storage,
  loadPlayer,
}: {
  storage: () => Storage | undefined;
  loadPlayer: (store: SoundStore) => Promise<Player>;
}): SoundStore {
  let state: SoundState = { muted: readMuted(storage), blocked: false };
  let due: SoundKind | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Partial<SoundState>) => {
    const merged = { ...state, ...next };
    if (merged.muted === state.muted && merged.blocked === state.blocked)
      return;
    state = merged;
    for (const l of listeners) l();
  };

  const store: SoundStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    setMuted(muted) {
      writeMuted(storage, muted);
      set({ muted });
    },
    async alert(kind) {
      if (state.muted) return;
      const played = await (await loadPlayer(store)).play(kind);
      due = played ? null : kind;
      set({ blocked: !played });
    },
    async enable() {
      store.setMuted(false);
      const player = await loadPlayer(store);
      const running = await player.resume();
      set({ blocked: !running });
      if (running && due !== null) {
        const kind = due;
        due = null;
        await player.play(kind);
      }
    },
    running() {
      set({ blocked: false });
    },
  };
  return store;
}

/** The browser's one store: `localStorage`, and the player on first need. */
export const sound = createSoundStore({
  storage: () =>
    typeof window === "undefined" ? undefined : window.localStorage,
  loadPlayer: (store) =>
    import("./player.ts").then(({ player }) => player(() => store.running())),
});

/** Before the browser's state is known (the server's render): neither. */
export const SERVER_SOUND_STATE: SoundState = { muted: false, blocked: false };
