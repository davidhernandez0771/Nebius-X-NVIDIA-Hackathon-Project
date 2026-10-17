// GPU time per frame via EXT_disjoint_timer_query_webgl2, where the browser offers it.
// The overlay shares the GPU with MediaPipe and Isaac Sim, so this is the number that matters.

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

const MAX_IN_FLIGHT = 4;

export class GpuTimer {
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {}

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  /** Starts timing this frame, unless too many earlier frames are still unread. */
  begin() {
    if (this.active || this.pending.length >= MAX_IN_FLIGHT) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** GPU ms of the frames whose results arrived since the last poll. */
  poll(): number[] {
    const out: number[] = [];
    const disjoint = !!this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0], this.gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      if (!disjoint) out.push(this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6);
      this.gl.deleteQuery(q);
    }
    return out;
  }

  dispose() {
    if (this.active) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending = [];
    this.active = null;
  }
}
