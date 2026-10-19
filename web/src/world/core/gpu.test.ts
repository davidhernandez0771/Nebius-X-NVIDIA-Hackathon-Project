import { describe, expect, it, vi } from "vitest";
import { BENCH_MS, checkGpu, classifyGpu, gpuLabel, probeGpu, type GpuReport } from "./gpu";

const r = (renderer: string, ms: number | null = 1, more: Partial<GpuReport> = {}): GpuReport => ({ webgl2: true, renderer, caveat: false, ms, ...more });

describe("classifyGpu", () => {
  it("sends no WebGL2, software renderers and the performance caveat to the stills", () => {
    expect(classifyGpu(r("", null, { webgl2: false }))).toBe("stills");
    expect(classifyGpu(r("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"))).toBe("stills");
    expect(classifyGpu(r("llvmpipe (LLVM 15.0.7, 256 bits)"))).toBe("stills");
    expect(classifyGpu(r("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)"))).toBe("stills");
    expect(classifyGpu(r("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080)", 1, { caveat: true }))).toBe("stills");
  });

  it("reads the GPU's name", () => {
    expect(classifyGpu(r("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)", 0.5))).toBe("ultra");
    expect(classifyGpu(r("ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11)", 0.8))).toBe("ultra");
    expect(classifyGpu(r("Apple M2 Max", 1))).toBe("ultra");
    expect(classifyGpu(r("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", 10))).toBe("high");
    expect(classifyGpu(r("Apple M1", 6))).toBe("high");
    expect(classifyGpu(r("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)", 8))).toBe("high");
    expect(classifyGpu(r("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", 10))).toBe("low");
    expect(classifyGpu(r("Mali-G57 MC2", 10))).toBe("low");
  });

  it("lets a slow timing lower the class, never raise it", () => {
    expect(classifyGpu(r("NVIDIA GeForce RTX 3050 Laptop GPU", BENCH_MS.ultra + 1))).toBe("high");
    expect(classifyGpu(r("Intel(R) Iris(R) Xe Graphics", BENCH_MS.high + 1))).toBe("low");
    expect(classifyGpu(r("Intel(R) Iris(R) Xe Graphics", BENCH_MS.stills + 1))).toBe("stills");
    expect(classifyGpu(r("Intel(R) UHD Graphics 620", 0.1))).toBe("low");
    expect(classifyGpu(r("Some Future GPU", 0.1))).toBe("high");
  });

  it("without a timing, trusts only the cautious half of the name", () => {
    expect(classifyGpu(r("NVIDIA GeForce RTX 5080", null))).toBe("high");
    expect(classifyGpu(r("Intel(R) UHD Graphics 620", null))).toBe("low");
  });
});

describe("checkGpu", () => {
  it("probes once per session and reuses the answer", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    const probe = vi.fn(() => r("NVIDIA GeForce RTX 5080", 0.5));
    expect(checkGpu(storage, probe).gpu).toBe("ultra");
    expect(checkGpu(storage, probe).gpu).toBe("ultra");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("still answers when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(checkGpu(storage, () => r("Intel(R) Iris(R) Xe Graphics", 9)).gpu).toBe("high");
  });

  it("finds no WebGL2 in jsdom, so the world falls back to the stills", () => {
    expect(classifyGpu(probeGpu())).toBe("stills");
  });
});

describe("gpuLabel", () => {
  it("unwraps Chrome's ANGLE string", () => {
    expect(gpuLabel("ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(
      "NVIDIA GeForce RTX 4060 Laptop GPU · D3D11",
    );
  });
  it("flags integrated graphics", () => {
    expect(gpuLabel("ANGLE (Intel, Intel(R) UHD Graphics (0x00009A68) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("Intel(R) UHD Graphics · D3D11  (integrated)");
    expect(gpuLabel("ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toContain("(integrated)");
  });
  it("keeps other strings as they are", () => {
    expect(gpuLabel("Apple M2")).toBe("Apple M2");
    expect(gpuLabel("")).toBe("unknown (the browser hides it)");
  });
});
