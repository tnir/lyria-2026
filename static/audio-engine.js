// Studio-Grade Real-Time Generative Web Audio Synthesizer + Lyria RealTime PCM Streamer

const NOTE_SEMITONES = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SCALES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

// Chord degree progressions (scale degree offsets)
const CHORD_PROGRESSIONS = {
  keynote_techno: [
    { nameSuffix: 'm9', degrees: [0, 2, 4, 6, 8] },
    { nameSuffix: 'maj7/VI', degrees: [5, 7, 9, 11] },
    { nameSuffix: 'm7/iv', degrees: [3, 5, 7, 9] },
    { nameSuffix: 'sus4/VII', degrees: [6, 9, 10, 13] },
  ],
  lyria_ambient: [
    { nameSuffix: 'add9', degrees: [0, 2, 4, 7, 8] },
    { nameSuffix: 'maj9', degrees: [3, 5, 7, 9, 11] },
    { nameSuffix: 'm11', degrees: [1, 3, 5, 7, 10] },
    { nameSuffix: 'sus2', degrees: [4, 5, 8, 11] },
  ],
  vegas_acid: [
    { nameSuffix: 'm7', degrees: [0, 2, 4, 6] },
    { nameSuffix: 'bII7', degrees: [1, 3, 5, 7] },
    { nameSuffix: 'm9', degrees: [0, 2, 4, 8] },
    { nameSuffix: 'dim7', degrees: [6, 8, 10, 12] },
  ],
  sunset_lofi: [
    { nameSuffix: 'm9', degrees: [0, 2, 4, 6, 8] },
    { nameSuffix: '13', degrees: [3, 5, 7, 9, 12] },
    { nameSuffix: 'maj9', degrees: [2, 4, 6, 8, 10] },
    { nameSuffix: '7alt', degrees: [4, 6, 8, 10] },
  ],
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class GenerativeAudioEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.bpm = 122;
    this.rootNote = 'C';
    this.scaleName = 'dorian';
    this.preset = 'keynote_techno';

    // Normalized synth parameters [0..1]
    this.filterCutoffNorm = 0.68;
    this.filterResonanceNorm = 0.3;
    this.reverbMix = 0.45;
    this.arpDensity = 0.65;
    this.drumIntensity = 0.65;
    this.masterVolume = 0.8;

    // Track mutes
    this.tracksEnabled = {
      pad: true,
      arp: true,
      bass: true,
      drums: true,
    };

    // 16-step pattern matrices (4 tracks x 16 steps)
    this.patterns = {
      pad:   [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      arp:   [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0],
      bass:  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0],
      drums: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0],
    };

    this.currentStep = 0;
    this.barCount = 0;
    this.chordIndex = 0;
    this.currentChordLabel = 'Cm9';
    this.stepTimer = null;
    this.onStepCallback = null;

    // Lyria RealTime audio stream queue
    this.lyriaNextPlayTime = 0;
  }

  initContext() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // Master chain: masterFilter -> dry + (delay + reverb) -> compressor -> masterGain -> analyser -> destination
    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 4200;
    this.masterFilter.Q.value = 2.2;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.18;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.82;

    // Delay node
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = (60 / this.bpm) * 0.75; // dotted 8th
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.36;
    this.delayFilter = this.ctx.createBiquadFilter();
    this.delayFilter.type = 'bandpass';
    this.delayFilter.frequency.value = 1600;
    this.delayFilter.Q.value = 0.9;

    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

    // Algorithmic Impulse Response Convolver Reverb
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this._createImpulseResponse(2.4, 2.5);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = this.reverbMix * 0.55;

    this.delayWetGain = this.ctx.createGain();
    this.delayWetGain.gain.value = this.reverbMix * 0.38;

    // Connect routing
    this.masterFilter.connect(this.compressor);
    this.masterFilter.connect(this.delayNode);
    this.masterFilter.connect(this.convolver);

    this.delayNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.compressor);

    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.compressor);

    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Noise buffer for drums & risers
    this.noiseBuffer = this._createNoiseBuffer(2.0);
    this._updateAudioParams();
  }

  _createImpulseResponse(durationSec, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  _createNoiseBuffer(durationSec) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * durationSec);
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  async start() {
    this.initContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this._scheduleLoop();
  }

  stop() {
    this.isPlaying = false;
    if (this.stepTimer) {
      clearTimeout(this.stepTimer);
      this.stepTimer = null;
    }
  }

  _scheduleLoop() {
    if (!this.isPlaying) return;
    const stepDurationMs = (60 / this.bpm / 4) * 1000; // 16th note
    this._playStep(this.currentStep);

    this.stepTimer = setTimeout(() => {
      this.currentStep = (this.currentStep + 1) % 16;
      if (this.currentStep === 0) {
        this.barCount++;
        this.chordIndex = (this.chordIndex + 1) % 4;
      }
      this._scheduleLoop();
    }, stepDurationMs);
  }

  _getScaleMidiNotes(baseOctave = 4) {
    const rootSemi = NOTE_SEMITONES[this.rootNote] ?? 0;
    const intervals = SCALES[this.scaleName] || SCALES.dorian;
    const baseMidi = 12 * (baseOctave + 1) + rootSemi;
    const notes = [];
    for (let oct = 0; oct < 3; oct++) {
      for (const iv of intervals) {
        notes.push(baseMidi + oct * 12 + iv);
      }
    }
    return notes;
  }

  _playStep(step) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const stepDurSec = 60 / this.bpm / 4;

    const progList = CHORD_PROGRESSIONS[this.preset] || CHORD_PROGRESSIONS.keynote_techno;
    const chordDef = progList[this.chordIndex % progList.length];
    this.currentChordLabel = `${this.rootNote}${chordDef.nameSuffix}`;

    const scaleNotes = this._getScaleMidiNotes(3);

    // 1. POLY PAD Track
    if (this.tracksEnabled.pad && this.patterns.pad[step]) {
      const chordMidis = chordDef.degrees.map((d) => scaleNotes[d % scaleNotes.length] + 12);
      this._triggerPadChord(chordMidis, now, stepDurSec * 7.5);
    }

    // 2. NEON ARP Track
    if (this.tracksEnabled.arp) {
      const shouldPlayArp =
        this.patterns.arp[step] && Math.random() <= 0.35 + this.arpDensity * 0.65;
      if (shouldPlayArp) {
        const degPool = chordDef.degrees;
        const pickIdx = (step + this.chordIndex * 2) % degPool.length;
        const octaveBoost = step % 4 === 0 && this.filterCutoffNorm > 0.6 ? 24 : 12;
        const noteMidi = scaleNotes[degPool[pickIdx] % scaleNotes.length] + octaveBoost;
        this._triggerArpNote(noteMidi, now, stepDurSec * 0.85);
      }
    }

    // 3. ACID BASS Track
    if (this.tracksEnabled.bass && this.patterns.bass[step]) {
      const rootDegree = chordDef.degrees[0];
      let bassMidi = scaleNotes[rootDegree % scaleNotes.length] - 12;
      if (step === 6 || step === 14) {
        bassMidi += 12; // Octave jump on off-beats
      } else if (step === 11 || step === 15) {
        bassMidi = scaleNotes[(rootDegree + 4) % scaleNotes.length] - 12;
      }
      const accent = step === 0 || step === 6 || step === 12;
      this._triggerAcidBass(bassMidi, now, stepDurSec * 0.9, accent);
    }

    // 4. PULSE DRUMS Track
    if (this.tracksEnabled.drums) {
      // Kick on 0, 4, 8, 12 (four-on-the-floor) or broken beat for lofi
      if (this.preset === 'sunset_lofi') {
        if (step === 0 || step === 7 || step === 10) {
          this._triggerKick(now);
        }
      } else if (this.preset !== 'lyria_ambient' || this.drumIntensity > 0.45) {
        if (step % 4 === 0 || (step === 14 && this.drumIntensity > 0.72)) {
          this._triggerKick(now);
        }
      }

      // Snare / Clap on 4 and 12
      if ((step === 4 || step === 12) && this.drumIntensity > 0.25) {
        this._triggerSnare(now);
      }

      // Hi-hats driven by pattern + drumIntensity
      if (this.patterns.drums[step] && Math.random() <= this.drumIntensity) {
        const isOpen = step % 4 === 2;
        this._triggerHiHat(now, isOpen);
      }
    }

    if (this.onStepCallback) {
      this.onStepCallback(step, this.currentChordLabel);
    }
  }

  _triggerPadChord(midiNotes, time, duration) {
    const voiceGain = (0.065 / Math.max(1, midiNotes.length)) * (this.preset === 'lyria_ambient' ? 1.4 : 1.0);
    midiNotes.forEach((midi, idx) => {
      const freq = midiToFreq(midi);
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(freq, time);
      osc1.detune.setValueAtTime(-9 + idx * 3, time);
      osc2.detune.setValueAtTime(9 - idx * 2, time);

      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(voiceGain, time + duration * 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      osc1.connect(env);
      osc2.connect(env);
      env.connect(this.masterFilter);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(time + duration + 0.05);
      osc2.stop(time + duration + 0.05);
    });
  }

  _triggerArpNote(midi, time, duration) {
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = this.preset === 'lyria_ambient' ? 'sine' : 'sawtooth';
    subOsc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    subOsc.frequency.setValueAtTime(freq * 2, time);
    subOsc.detune.setValueAtTime(7, time);

    filter.type = 'lowpass';
    const baseCut = 600 + this.filterCutoffNorm * 6500;
    filter.frequency.setValueAtTime(baseCut, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(300, baseCut * 0.25), time + duration);
    filter.Q.value = 2 + this.filterResonanceNorm * 6;

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.11, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(env);
    env.connect(this.masterFilter);

    osc.start(time);
    subOsc.start(time);
    osc.stop(time + duration + 0.02);
    subOsc.stop(time + duration + 0.02);
  }

  _triggerAcidBass(midi, time, duration, accent = false) {
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = this.preset === 'vegas_acid' ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    const peakCut = (accent ? 2800 : 1400) * (0.4 + this.filterCutoffNorm * 0.9);
    filter.frequency.setValueAtTime(peakCut, time);
    filter.frequency.exponentialRampToValueAtTime(110, time + duration * 0.85);
    filter.Q.value = (this.preset === 'vegas_acid' ? 9.5 : 4.5) + this.filterResonanceNorm * 6;

    const peakGain = accent ? 0.22 : 0.16;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peakGain, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.compressor); // keep bass tight and punchy

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  _triggerKick(time) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.085);

    env.gain.setValueAtTime(0.45, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    osc.connect(env);
    env.connect(this.compressor);

    osc.start(time);
    osc.stop(time + 0.3);
  }

  _triggerSnare(time) {
    // Noise burst
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(700, time);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.18, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    noise.connect(filter);
    filter.connect(env);
    env.connect(this.masterFilter);

    noise.start(time);
    noise.stop(time + 0.18);
  }

  _triggerHiHat(time, isOpen = false) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6800, time);

    const dur = isOpen ? 0.18 : 0.045;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(isOpen ? 0.09 : 0.065, time);
    env.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    noise.connect(filter);
    filter.connect(env);
    env.connect(this.masterFilter);

    noise.start(time);
    noise.stop(time + dur + 0.01);
  }

  triggerDrop() {
    this.initContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 1.2);

    env.gain.setValueAtTime(0.01, now);
    env.gain.linearRampToValueAtTime(0.22, now + 1.1);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);

    osc.connect(env);
    env.connect(this.masterFilter);
    osc.start(now);
    osc.stop(now + 1.4);

    // Regenerate variations in arp/bass patterns on drop
    for (let i = 0; i < 16; i++) {
      this.patterns.arp[i] = i % 2 === 0 || Math.random() > 0.35 ? 1 : 0;
      this.patterns.bass[i] = i === 0 || i === 3 || i === 6 || i === 10 || i === 14 ? 1 : 0;
    }
  }

  setParameters({
    bpm,
    rootNote,
    scaleName,
    preset,
    filterCutoffNorm,
    filterResonanceNorm,
    reverbMix,
    arpDensity,
    drumIntensity,
    masterVolume,
  }) {
    if (bpm !== undefined) this.bpm = Math.max(75, Math.min(155, Number(bpm)));
    if (rootNote !== undefined) this.rootNote = rootNote;
    if (scaleName !== undefined && SCALES[scaleName]) this.scaleName = scaleName;
    if (preset !== undefined && CHORD_PROGRESSIONS[preset]) this.preset = preset;
    if (filterCutoffNorm !== undefined) this.filterCutoffNorm = Math.max(0.05, Math.min(1, filterCutoffNorm));
    if (filterResonanceNorm !== undefined) this.filterResonanceNorm = Math.max(0, Math.min(1, filterResonanceNorm));
    if (reverbMix !== undefined) this.reverbMix = Math.max(0, Math.min(0.95, reverbMix));
    if (arpDensity !== undefined) this.arpDensity = Math.max(0.05, Math.min(1, arpDensity));
    if (drumIntensity !== undefined) this.drumIntensity = Math.max(0.05, Math.min(1, drumIntensity));
    if (masterVolume !== undefined) this.masterVolume = Math.max(0, Math.min(1, masterVolume));

    this._updateAudioParams();
  }

  _updateAudioParams() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Exponential mapping from [0..1] to [220Hz .. 13500Hz]
    const cutoffHz = 220 * Math.pow(61, this.filterCutoffNorm);
    this.masterFilter.frequency.setTargetAtTime(cutoffHz, now, 0.05);
    this.masterFilter.Q.setTargetAtTime(1.2 + this.filterResonanceNorm * 9.5, now, 0.05);
    this.reverbGain.gain.setTargetAtTime(this.reverbMix * 0.6, now, 0.06);
    this.delayWetGain.gain.setTargetAtTime(this.reverbMix * 0.42, now, 0.06);
    this.delayNode.delayTime.setTargetAtTime((60 / this.bpm) * 0.75, now, 0.08);
    this.masterGain.gain.setTargetAtTime(this.masterVolume, now, 0.04);
  }

  queueLyriaPcmChunk(base64Data, sampleRate = 48000) {
    this.initContext();
    const binaryStr = atob(base64Data);
    const byteLen = binaryStr.length;
    const int16 = new Int16Array(byteLen / 2);
    for (let i = 0; i < int16.length; i++) {
      const low = binaryStr.charCodeAt(i * 2);
      const high = binaryStr.charCodeAt(i * 2 + 1);
      const val = (high << 8) | low;
      int16[i] = val >= 0x8000 ? val - 0x10000 : val;
    }

    // Stereo 2-channel interleaved PCM from Lyria RealTime
    const channels = 2;
    const frameCount = Math.floor(int16.length / channels);
    if (frameCount <= 0) return;

    const audioBuffer = this.ctx.createBuffer(channels, frameCount, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = int16[i * channels + ch] / 32768.0;
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.masterGain);

    const now = this.ctx.currentTime;
    if (this.lyriaNextPlayTime < now) {
      this.lyriaNextPlayTime = now + 0.08;
    }
    source.start(this.lyriaNextPlayTime);
    this.lyriaNextPlayTime += audioBuffer.duration;
  }

  getSpectrumData() {
    if (!this.analyser) return new Uint8Array(64);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }
}
