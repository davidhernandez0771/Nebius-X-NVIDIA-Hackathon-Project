import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ALL_MODELS } from "./assets";
import { OFF } from "./flicker";
import { addBaked, addEnvironment, addGlow, addLight, loadProgress, markLoaded, power, resetPower, setGlowGain, setPower } from "./power";

afterEach(() => resetPower());

describe("the lamps' switch", () => {
  it("scales the baked room, the live lights, the glows and the scene's reflections together", () => {
    const room = new THREE.MeshBasicMaterial();
    const key = new THREE.DirectionalLight();
    const strip = new THREE.MeshBasicMaterial();
    const scene = new THREE.Scene();
    const offs = [addBaked(room), addLight(key, 2), addGlow(strip, "#ff0000"), addEnvironment(scene, 0.5)];
    // Starts off: everything at the OFF level.
    expect(room.color.r).toBeCloseTo(OFF, 6);
    expect(key.intensity).toBeCloseTo(2 * OFF, 6);
    expect(scene.environmentIntensity).toBeCloseTo(0.5 * OFF, 6);
    setPower(1);
    expect(room.color.r).toBe(1);
    expect(key.intensity).toBe(2);
    expect(strip.color.r).toBeCloseTo(1, 6);
    // three ignores material.envMapIntensity for scene.environment, so the scene's own value must move.
    expect(scene.environmentIntensity).toBe(0.5);
    setGlowGain(strip, 0.25);
    expect(strip.color.r).toBeCloseTo(0.25, 6);
    offs.forEach((f) => f());
    setPower(0.5);
    expect(key.intensity).toBe(2);
    expect(power.level).toBe(0.5);
  });

  it("counts the workshop's files in", () => {
    expect(loadProgress()).toBe(0);
    ALL_MODELS.slice(0, 3).forEach(markLoaded);
    expect(loadProgress()).toBeCloseTo(3 / ALL_MODELS.length, 6);
    ALL_MODELS.forEach(markLoaded);
    expect(loadProgress()).toBe(1);
  });
});
