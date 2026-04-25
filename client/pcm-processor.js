class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global in AudioWorkletGlobalScope — actual AudioContext rate
    this.ratio = sampleRate / 16000;
    this._phase = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0];

    if (this.ratio === 1) {
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
      return true;
    }

    // Downsample to 16000 Hz with linear interpolation
    const out = [];
    while (this._phase < float32.length) {
      const idx = Math.floor(this._phase);
      const frac = this._phase - idx;
      const a = float32[idx];
      const b = idx + 1 < float32.length ? float32[idx + 1] : a;
      out.push(a + frac * (b - a));
      this._phase += this.ratio;
    }
    this._phase -= float32.length;

    if (out.length === 0) return true;

    const int16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const s = Math.max(-1, Math.min(1, out[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
