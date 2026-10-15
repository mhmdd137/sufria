/**
 * The two alert sounds, made in the browser with Web Audio — no sound file
 * (brief م-ب, decision 5; the recipe verbatim from the review page). Loaded
 * with `import()` by `sound-store.ts` the first time something must ring.
 *
 * The `AudioContext` is made on that first need, and asked to run again with
 * the first press or key anywhere on the page: a browser keeps audio stopped
 * until the page has been pressed.
 */
import type { Player, SoundKind } from "./sound-store.ts";

/** How long `resume()` may take before the audio counts as stopped. */
const RESUME_WAIT_MS = 300;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function blip(
  t: number,
  f: number,
  dur: number,
  {
    type = "sine",
    gain = 0.35,
    to = null,
  }: { type?: OscillatorType; gain?: number; to?: number | null } = {},
): void {
  const o = ctx!.createOscillator(),
    g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** O2 — new order: three rising triangle notes. M1 — a message: one falling sine tick. */
function ring(kind: SoundKind): void {
  const t = ctx!.currentTime;
  if (kind === "order")
    [880, 1109, 1319].forEach((f, i) =>
      blip(t + i * 0.15, f, 0.16, { type: "triangle", gain: 0.42 }),
    );
  else blip(t, 990, 0.14, { gain: 0.4, to: 740 });
}

function context(onRunning: () => void): AudioContext | null {
  if (ctx) return ctx;
  if (typeof AudioContext === "undefined") return null;
  ctx = new AudioContext();
  // master: one GainNode at 0.9 → ctx.destination
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const c = ctx;
  const wake = () => {
    if (c.state !== "running") void c.resume();
  };
  document.addEventListener("pointerdown", wake, true);
  document.addEventListener("keydown", wake, true);
  c.addEventListener("statechange", () => {
    if (c.state === "running") onRunning();
  });
  return c;
}

async function resume(onRunning: () => void): Promise<boolean> {
  const c = context(onRunning);
  if (!c) return false;
  if (c.state !== "running")
    // A browser that keeps the audio stopped may leave this pending.
    await Promise.race([
      c.resume(),
      new Promise((done) => setTimeout(done, RESUME_WAIT_MS)),
    ]);
  return c.state === "running";
}

/** `onRunning`: the browser let the audio run, after a press anywhere. */
export function player(onRunning: () => void): Player {
  return {
    resume: () => resume(onRunning),
    async play(kind) {
      if (!(await resume(onRunning))) return false;
      ring(kind);
      return true;
    },
  };
}
