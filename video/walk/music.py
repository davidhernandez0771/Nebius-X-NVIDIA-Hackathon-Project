"""A quiet music bed for the walkthrough, composed in code (numpy only), so it is ours and free to use.

Soft chords (Dmaj9, Bm11, Gmaj7#11, A6sus4, two bars each at 80 bpm) with a plucked arpeggio over them and a room
reverb, voiced high so it sits around the voice rather than under it. It follows the film's sections: chords alone over the boot, the arpeggio from the story on, a second, lower
arpeggio from the workshop, light ticks through the live part, and the chords alone again for the ending, which rings
out on the first chord under the end card. Nothing sits under 140 Hz, so there is no hum.

    from music import compose; compose(length_s, cues, out_wav)
    cues: {"story": t, "workshop": t, "record": t, "future": t} (film seconds where each section starts)
"""
import wave

import numpy as np

SR = 48000
BPM = 80
BEAT = 60 / BPM
BAR = 4 * BEAT
CHORDS = [  # (pad notes, arpeggio notes) as MIDI numbers
    ([50, 57, 61, 64, 66], [69, 73, 76, 78, 81]),  # Dmaj9
    ([47, 54, 57, 62, 64], [66, 69, 71, 74, 76]),  # Bm11
    ([43, 50, 54, 59, 61], [67, 71, 73, 74, 78]),  # Gmaj7#11
    ([45, 52, 57, 59, 62], [64, 66, 69, 71, 74]),  # A6sus4
]
ARP = [0, 2, 1, 3, 2, 4, 3, 1]  # which arpeggio note on each eighth of a bar


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def envelope(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[n - r:] *= np.linspace(1, 0, r) ** 2
    return e


def pad_note(m, dur, bright, rng):
    """One held note: a few soft harmonics, two copies a few cents apart (one per side)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for side, cents in ((0, -4), (1, 4)):
        f = hz(m) * 2 ** (cents / 1200)
        ph = rng.uniform(0, 2 * np.pi, 8)
        tone = sum(np.sin(2 * np.pi * f * k * t + ph[k]) / k ** (2.2 - 0.6 * bright) for k in range(1, 7))
        out[:, side] = tone * (1 + 0.08 * np.sin(2 * np.pi * (0.13 + 0.02 * side) * t))
    return out


def pluck(m, vel, dur=1.6):
    """A soft electric-piano-like pluck: a sine with two quiet overtones, decaying."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    tone = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.3)
            + 0.15 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.15) + 0.06 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.08))
    env = np.exp(-t / 0.55) * np.minimum(1, t / 0.004)
    return vel * tone * env


def add(buf, sig, at, pan=0.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    if sig.ndim == 1:
        g = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
        buf[i:i + len(sig)] += sig[:, None] * g
    else:
        buf[i:i + len(sig)] += sig


def highpass(x, cutoff):
    """A gentle high-pass on the whole signal, done in the frequency domain."""
    spec = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    gain = 1 / np.sqrt(1 + (cutoff / np.maximum(f, 1e-3)) ** 8)
    return np.fft.irfft(spec * gain[:, None], n=len(x), axis=0)


def reverb(x, seconds=2.8, mix=0.32, seed=7):
    """A room: convolution with decaying, darkening stereo noise, block by block."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t / (seconds / 6.9))[:, None]
    # darker as it decays: smooth the tail by averaging with a shifted copy, more of it later on
    k = np.minimum(1, t / seconds)[:, None]
    ir = (1 - 0.5 * k) * ir + 0.5 * k * np.roll(ir, 3, axis=0)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    block = 1 << 18
    size = 1 << int(np.ceil(np.log2(block + n)))
    irf = np.fft.rfft(ir, size, axis=0)
    wet = np.zeros((len(x) + n, 2))
    for s in range(0, len(x), block):
        seg = x[s:s + block]
        y = np.fft.irfft(np.fft.rfft(seg, size, axis=0) * irf, size, axis=0)[: len(seg) + n]
        wet[s:s + len(y)] += y
    return (1 - mix) * x + mix * wet[: len(x)] * 3.0


def compose(length, cues, out_path, seed=3):
    rng = np.random.default_rng(seed)
    total = length + 3.0  # room for the last chord to ring
    pad = np.zeros((int(total * SR), 2))
    arp = np.zeros_like(pad)
    low = np.zeros_like(pad)
    tick = np.zeros_like(pad)
    story, workshop, record, future = cues["story"], cues["workshop"], cues["record"], cues["future"]

    t, c = 0.0, 0
    while t < length:
        notes, top = CHORDS[c % 4]
        last = t + 2 * BAR >= length
        dur = (length - t + 3.0) if last else 2 * BAR + 1.6
        bright = 1.0 if workshop <= t < future else 0.4
        for m in notes:
            m += 12  # an octave up: no low drone
            add(pad, pad_note(m, dur, bright, rng) * envelope(int(dur * SR), 1.4, 2.4 if last else 1.6)[:, None], t)
        for e in range(16):  # two bars of eighths
            at = t + e * BEAT / 2 + rng.normal(0, 0.006)
            if story <= at < future and at < length - 2:
                m = top[ARP[e % 8]]
                vel = rng.uniform(0.55, 1.0) * (0.75 if e % 2 else 1.0)
                add(arp, pluck(m, vel), max(0, at), pan=rng.uniform(-0.5, 0.5))
            if workshop <= at < future and e % 4 == 0:  # quarter notes an octave below
                add(low, pluck(top[ARP[(e // 2) % 8]] - 12, rng.uniform(0.6, 0.8), dur=2.4), max(0, at), pan=rng.uniform(-0.2, 0.2))
            if record <= at < future:  # sixteenth ticks, very quiet
                for half in (0, BEAT / 4):
                    n = int(0.03 * SR)
                    tt = np.arange(n) / SR
                    click = np.sin(2 * np.pi * 5200 * tt) * np.exp(-tt / 0.006) * rng.uniform(0.3, 0.6)
                    add(tick, click, max(0, at + half), pan=rng.uniform(-0.6, 0.6))
        t += 2 * BAR
        c += 1
        if last:
            break

    # levels per layer, with the arpeggio easing in and the whole bed fading out under the end card
    def ramp(a, b):
        x = np.arange(len(pad)) / SR
        return np.clip((x - a) / (b - a), 0, 1)[:, None]

    mix = 0.045 * pad + 0.22 * arp * ramp(story, story + 6) + 0.10 * low * ramp(workshop, workshop + 4) + 0.05 * tick * ramp(record, record + 3)
    mix *= (1 - ramp(length - 4.0, length + 2.5))
    mix = reverb(highpass(mix, 140))
    mix = highpass(mix, 140)
    mix = mix[: int((length + 0.0) * SR)]
    mix *= 10 ** (-3 / 20) / np.abs(mix).max()
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    return out_path


if __name__ == "__main__":
    import sys
    # a preview: python video/walk/music.py out.wav
    compose(60.0, {"story": 8.0, "workshop": 24.0, "record": 36.0, "future": 48.0}, sys.argv[1] if len(sys.argv) > 1 else "music_preview.wav")
