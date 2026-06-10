type SoundKind = "button" | "correct" | "wrong";

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext ??= new AudioContextCtor();
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

function tone(frequency: number, start: number, duration: number, gain: number, type: OscillatorType) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function play(kind: SoundKind) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (kind === "button") {
    tone(880, now, 0.035, 0.012, "sine");
    return;
  }

  if (kind === "correct") {
    tone(660, now, 0.075, 0.025, "sine");
    tone(990, now + 0.055, 0.09, 0.022, "sine");
    return;
  }

  tone(220, now, 0.095, 0.022, "triangle");
  tone(165, now + 0.055, 0.12, 0.016, "triangle");
}

export function playButtonSound() {
  play("button");
}

export function playCorrectSound() {
  play("correct");
}

export function playWrongSound() {
  play("wrong");
}
