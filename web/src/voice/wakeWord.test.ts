import { describe, expect, it } from "vitest";
import { containsWakeWord, textAfterWakeWord } from "./wakeWord";

describe("containsWakeWord", () => {
  it("detects the bare wake word", () => {
    expect(containsWakeWord("Sant")).toBe(true);
    expect(containsWakeWord("sant")).toBe(true);
  });

  it("detects the wake word among other speech", () => {
    expect(containsWakeWord("hey sant activate camera control")).toBe(true);
    expect(containsWakeWord("okay Sant, go home")).toBe(true);
  });

  it("does not match the wake word as a substring of another word", () => {
    expect(containsWakeWord("that was instant")).toBe(false);
    expect(containsWakeWord("santa claus is coming")).toBe(false);
  });

  it("returns false when the wake word is absent", () => {
    expect(containsWakeWord("go to the inventory page")).toBe(false);
    expect(containsWakeWord("")).toBe(false);
  });

  it("normalizes punctuation and whitespace before matching", () => {
    expect(containsWakeWord("Sant,   activate   camera.")).toBe(true);
  });
});

describe("textAfterWakeWord", () => {
  it("returns the trailing command text after the wake word", () => {
    expect(textAfterWakeWord("sant activate camera control")).toBe("activate camera control");
  });

  it("returns an empty string when the wake word is the whole utterance", () => {
    expect(textAfterWakeWord("Sant")).toBe("");
  });

  it("returns an empty string when the wake word is absent", () => {
    expect(textAfterWakeWord("go to the inventory page")).toBe("");
  });

  it("only takes text after the FIRST occurrence", () => {
    expect(textAfterWakeWord("sant sant activate camera")).toBe("sant activate camera");
  });
});
