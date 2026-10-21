// The intro's numbers, read from the Results page's data (site/results: results.json and the generated
// stores.json), so regenerating the results updates the story. The forest beat quotes the webcam demos' 9/10 and
// 927 N; the proof beat the multiply result, the webcam pipeline and Nemotron's labels.
import { experiment, fact, formatP, measured } from "../../../site/results/data";

const kn = (a: { k: number; n: number }) => `${a.k}/${a.n}`;

const raw = measured("multiply", "raw_10_30k");
const multiplied = measured("multiply", "raw_multiply_10_30k");
const p = experiment("multiply").groups[0].comparisons.find((c) => c.a === raw.key && c.b === multiplied.key)?.p;
if (p == null) throw new Error("results.json has no measured p for raw_10_30k vs raw_multiply_10_30k");
const webcam = measured("webcam", "webcam_raw");

export const PROOF = {
  raw: kn(raw),
  multiplied: kn(multiplied),
  p: formatP(p),
  webcam: {
    demos: webcam.n,
    passed: kn(webcam),
    repaired: measured("webcam", "webcam_repaired").k,
    copies: measured("webcam", "webcam_copies").k,
  },
  labels: kn(measured("nemotron", "labeler_nemotron")),
  pressed: fact("webcam_pressed").text,
  peak: fact("webcam_peak_n").text,
};
