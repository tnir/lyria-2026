import { GenerativeAudioEngine } from './audio-engine.js';
import { VisionEngine } from './vision-engine.js';

const videoEl = document.getElementById('webcamVideo');
const stageCanvas = document.getElementById('stageCanvas');
const spectrumCanvas = document.getElementById('spectrumCanvas');
const spectrumCtx = spectrumCanvas.getContext('2d');

const audioEngine = new GenerativeAudioEngine();
const visionEngine = new VisionEngine(videoEl, stageCanvas);

// UI Elements
const btnStartAll = document.getElementById('btnStartAll');
const btnSimMode = document.getElementById('btnSimMode');
const btnAnalyzeNow = document.getElementById('btnAnalyzeNow');
const btnApiModal = document.getElementById('btnApiModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnSaveApi = document.getElementById('btnSaveApi');
const apiModalBackdrop = document.getElementById('apiModalBackdrop');
const inputApiKey = document.getElementById('inputApiKey');
const chkEnableLyriaStream = document.getElementById('chkEnableLyriaStream');
const lyriaStreamStatus = document.getElementById('lyriaStreamStatus');

const liveBadge = document.getElementById('liveBadge');
const liveStatusText = document.getElementById('liveStatusText');
const pillSource = document.getElementById('pillSource');
const pillHands = document.getElementById('pillHands');
const pillKeyBpm = document.getElementById('pillKeyBpm');

const leftHandVal = document.getElementById('leftHandVal');
const rightHandVal = document.getElementById('rightHandVal');
const aiSceneText = document.getElementById('aiSceneText');
const aiDirectionText = document.getElementById('aiDirectionText');
const aiSourceBadge = document.getElementById('aiSourceBadge');

const valBrightness = document.getElementById('valBrightness');
const barBrightness = document.getElementById('barBrightness');
const valMotion = document.getElementById('valMotion');
const barMotion = document.getElementById('barMotion');
const valHue = document.getElementById('valHue');
const markerHue = document.getElementById('markerHue');
const valGesture = document.getElementById('valGesture');
const barGesture = document.getElementById('barGesture');

const chkCameraSteer = document.getElementById('chkCameraSteer');
const chkAutoGemini = document.getElementById('chkAutoGemini');
const stepGridContainer = document.getElementById('stepGridContainer');
const txtCurrentChord = document.getElementById('txtCurrentChord');
const txtStepCount = document.getElementById('txtStepCount');

const weightedPromptsList = document.getElementById('weightedPromptsList');
const inputCustomPrompt = document.getElementById('inputCustomPrompt');
const btnAddPrompt = document.getElementById('btnAddPrompt');
const btnTriggerDrop = document.getElementById('btnTriggerDrop');

const sliderBpm = document.getElementById('sliderBpm');
const lblBpm = document.getElementById('lblBpm');
const sliderCutoff = document.getElementById('sliderCutoff');
const lblCutoff = document.getElementById('lblCutoff');
const sliderReverb = document.getElementById('sliderReverb');
const lblReverb = document.getElementById('lblReverb');
const sliderArp = document.getElementById('sliderArp');
const lblArp = document.getElementById('lblArp');
const sliderVolume = document.getElementById('sliderVolume');
const lblVolume = document.getElementById('lblVolume');

const selectRoot = document.getElementById('selectRoot');
const selectScale = document.getElementById('selectScale');

// State
let userApiKey = localStorage.getItem('nototoki_gemini_api_key') || '';
inputApiKey.value = userApiKey;

let weightedPrompts = [
  { text: 'Futuristic Melodic Techno, Lush Analog Synth Pad', weight: 1.0 },
  { text: 'Crisp Pluck Arpeggio & Deep Sub Bassline', weight: 0.78 },
  { text: 'Dynamic Four-on-the-Floor Future VJ Groove', weight: 0.65 },
];

let lyriaSocket = null;
let autoAnalyzeInterval = null;
let isAnalyzing = false;

// 1. Build 16-Step Sequencer Grid UI
const TRACK_META = [
  { key: 'pad', label: 'POLY PAD', cls: 'on-pad' },
  { key: 'arp', label: 'NEON ARP', cls: 'on-arp' },
  { key: 'bass', label: 'ACID BASS', cls: 'on-bass' },
  { key: 'drums', label: 'DRUM PULSE', cls: 'on-drums' },
];

function renderSequencerGrid() {
  stepGridContainer.innerHTML = '';
  for (const track of TRACK_META) {
    const rowEl = document.createElement('div');
    rowEl.className = 'seq-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'seq-row-label';
    labelEl.textContent = track.label;
    rowEl.appendChild(labelEl);

    for (let s = 0; s < 16; s++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      cell.dataset.track = track.key;
      cell.dataset.step = String(s);
      if (audioEngine.patterns[track.key][s]) {
        cell.classList.add(track.cls);
      }
      cell.addEventListener('click', () => {
        audioEngine.patterns[track.key][s] = audioEngine.patterns[track.key][s] ? 0 : 1;
        cell.classList.toggle(track.cls, Boolean(audioEngine.patterns[track.key][s]));
      });
      rowEl.appendChild(cell);
    }
    stepGridContainer.appendChild(rowEl);
  }
}

function highlightSequencerStep(step, chordLabel) {
  txtCurrentChord.textContent = `CHORD: ${chordLabel}`;
  txtStepCount.textContent = `STEP: ${String(step + 1).padStart(2, '0')} / 16`;
  pillKeyBpm.textContent = `🎵 ${audioEngine.rootNote} ${audioEngine.scaleName.toUpperCase()} • ${Math.round(audioEngine.bpm)} BPM`;

  const allCells = stepGridContainer.querySelectorAll('.seq-cell');
  allCells.forEach((cell) => {
    const cellStep = Number(cell.dataset.step);
    const trackKey = cell.dataset.track;
    const meta = TRACK_META.find((t) => t.key === trackKey);
    cell.classList.toggle('playhead', cellStep === step);
    if (meta) {
      cell.classList.toggle(meta.cls, Boolean(audioEngine.patterns[trackKey][cellStep]));
    }
  });
}

audioEngine.onStepCallback = highlightSequencerStep;

// 2. Render Weighted Prompts UI
function renderWeightedPrompts() {
  weightedPromptsList.innerHTML = '';
  weightedPrompts.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'prompt-item';
    div.innerHTML = `
      <div class="prompt-item-top">
        <span class="prompt-text">${item.text}</span>
        <span class="prompt-weight" id="pwVal_${idx}">${Number(item.weight).toFixed(2)}</span>
      </div>
      <input type="range" class="prompt-slider" min="0.05" max="1.0" step="0.05" value="${item.weight}" data-idx="${idx}" />
    `;
    const slider = div.querySelector('.prompt-slider');
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      weightedPrompts[idx].weight = val;
      document.getElementById(`pwVal_${idx}`).textContent = val.toFixed(2);
      sendPromptsToLyriaIfConnected();
    });
    weightedPromptsList.appendChild(div);
  });
}

btnAddPrompt.addEventListener('click', () => {
  const txt = inputCustomPrompt.value.trim();
  if (!txt) return;
  weightedPrompts.unshift({ text: txt, weight: 0.9 });
  if (weightedPrompts.length > 4) weightedPrompts.pop();
  inputCustomPrompt.value = '';
  renderWeightedPrompts();
  sendPromptsToLyriaIfConnected();
});

// 3. Camera-to-Music Real-Time Parameter Steering
function steerMusicFromVision(telemetry) {
  const bPct = Math.round(telemetry.brightness * 100);
  const mPct = Math.round(telemetry.motionEnergy * 100);
  const hueDeg = Math.round(telemetry.dominantHue);
  const gPct = Math.round(telemetry.gestureMod * 100);

  valBrightness.textContent = `${bPct}%`;
  barBrightness.style.width = `${bPct}%`;

  valMotion.textContent = `${mPct}%`;
  barMotion.style.width = `${mPct}%`;

  valHue.textContent = `${hueDeg}°`;
  markerHue.style.left = `${(hueDeg / 360) * 100}%`;

  valGesture.textContent = `${gPct}%`;
  barGesture.style.width = `${gPct}%`;

  pillHands.textContent = `🖐 HANDS: ${telemetry.handsCount}`;
  pillSource.textContent = visionEngine.isSimulated ? '🎥 SOURCE: VIRTUAL SIM' : '📷 SOURCE: PC CAMERA';

  if (telemetry.leftHand) {
    const lhHeight = Math.round((1 - telemetry.leftHand.y) * 100);
    const lhPinch = Math.round(telemetry.leftHand.pinch * 100);
    leftHandVal.textContent = `Filter: ${lhHeight}% | Resonance Pinch: ${lhPinch}%`;
  } else {
    leftHandVal.textContent = `輝度連動 Filter: ${bPct}% (左手をかざすと直接制御)`;
  }

  if (telemetry.rightHand) {
    const rhHeight = Math.round((1 - telemetry.rightHand.y) * 100);
    const rhPinch = Math.round(telemetry.rightHand.pinch * 100);
    rightHandVal.textContent = `Arp密度: ${rhHeight}% | Pulse Pinch: ${rhPinch}%`;
  } else {
    rightHandVal.textContent = `モーション連動 Pulse: ${mPct}% (右手をかざすと直接制御)`;
  }

  if (!chkCameraSteer.checked) return;

  // Map Left Hand Y (or Brightness) -> Filter Cutoff
  const targetCutoff = telemetry.leftHand
    ? Math.max(0.12, Math.min(0.98, 1 - telemetry.leftHand.y))
    : Math.max(0.18, Math.min(0.95, telemetry.brightness * 0.85 + telemetry.motionEnergy * 0.25));

  // Map Right Hand Y (or Motion Energy) -> Arp Density
  const targetArp = telemetry.rightHand
    ? Math.max(0.15, Math.min(1.0, 1 - telemetry.rightHand.y))
    : Math.max(0.25, Math.min(0.95, 0.35 + telemetry.motionEnergy * 0.65));

  const targetDrumIntensity = Math.max(0.25, Math.min(1.0, 0.4 + telemetry.motionEnergy * 0.65));
  const targetResonance = telemetry.gestureMod;

  audioEngine.setParameters({
    filterCutoffNorm: targetCutoff,
    filterResonanceNorm: targetResonance,
    arpDensity: targetArp,
    drumIntensity: targetDrumIntensity,
  });

  // Update UI sliders smoothly to reflect camera steering
  sliderCutoff.value = String(Math.round(targetCutoff * 100));
  lblCutoff.textContent = `${Math.round(targetCutoff * 100)}%`;

  sliderArp.value = String(Math.round(targetArp * 100));
  lblArp.textContent = `${Math.round(targetArp * 100)}%`;
}

// 4. Gemini AI Frame Analysis (/api/analyze-frame)
async function triggerFrameAnalysis() {
  if (isAnalyzing) return;
  isAnalyzing = true;
  btnAnalyzeNow.textContent = '⏳ AI解析中...';

  try {
    const jpegBase64 = visionEngine.captureJpegBase64();
    const t = visionEngine.telemetry;
    const resp = await fetch('/api/analyze-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: jpegBase64,
        api_key: userApiKey || null,
        current_genre: audioEngine.preset,
        motion_energy: t.motionEnergy,
        brightness: t.brightness,
        dominant_hue: t.dominantHue,
        hand_summary: t.handSummary,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      aiSceneText.textContent = `[${data.scene_mood}] ${data.scene_description_ja}`;
      aiDirectionText.textContent = data.musical_direction_ja;
      aiSourceBadge.textContent =
        data.source.startsWith('gemini') ? data.source.toUpperCase() : 'REALTIME VISION AI';

      if (data.weighted_prompts && data.weighted_prompts.length > 0) {
        weightedPrompts = data.weighted_prompts;
        renderWeightedPrompts();
        sendPromptsToLyriaIfConnected();
      }

      if (chkCameraSteer.checked) {
        audioEngine.setParameters({
          bpm: data.suggested_bpm,
          rootNote: data.root_note,
          scaleName: data.suggested_scale,
          reverbMix: data.reverb_mix,
        });
        sliderBpm.value = String(data.suggested_bpm);
        lblBpm.textContent = `${data.suggested_bpm} BPM`;
        selectRoot.value = data.root_note;
        selectScale.value = data.suggested_scale;
        sliderReverb.value = String(Math.round(data.reverb_mix * 100));
        lblReverb.textContent = `${Math.round(data.reverb_mix * 100)}%`;
      }
    }
  } catch (err) {
    console.warn('Frame analysis error:', err);
  } finally {
    isAnalyzing = false;
    btnAnalyzeNow.textContent = '✨ AIシーン解析';
  }
}

// 5. Optional Lyria RealTime WebSocket Streaming
function connectLyriaWebSocket() {
  if (lyriaSocket) {
    lyriaSocket.close();
    lyriaSocket = null;
  }
  if (!chkEnableLyriaStream.checked) {
    lyriaStreamStatus.textContent = 'ステータス: 内蔵Web Audioジェネレーティブ・シンセサイザー稼働中';
    return;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws/lyria`;
  lyriaStreamStatus.textContent = 'ステータス: Lyria RealTime (models/lyria-realtime-exp) へ接続中...';

  lyriaSocket = new WebSocket(wsUrl);
  lyriaSocket.onopen = () => {
    lyriaSocket.send(
      JSON.stringify({
        action: 'init',
        api_key: userApiKey || null,
      })
    );
    sendPromptsToLyriaIfConnected();
    lyriaSocket.send(
      JSON.stringify({
        action: 'set_config',
        config: {
          bpm: audioEngine.bpm,
          density: audioEngine.arpDensity,
          brightness: audioEngine.filterCutoffNorm,
          guidance: 4.0,
        },
      })
    );
    lyriaSocket.send(JSON.stringify({ action: 'play' }));
  };

  lyriaSocket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        lyriaStreamStatus.textContent = `ステータス: 接続完了 (${msg.model}) — リアルタイム音声受信中`;
      } else if (msg.type === 'audio' && msg.data) {
        audioEngine.queueLyriaPcmChunk(msg.data, 48000);
      } else if (msg.type === 'error') {
        lyriaStreamStatus.textContent = `ステータス: ${msg.message}`;
      }
    } catch (e) {
      console.warn('Lyria WS message parse error:', e);
    }
  };

  lyriaSocket.onclose = () => {
    lyriaSocket = null;
  };
}

function sendPromptsToLyriaIfConnected() {
  if (lyriaSocket && lyriaSocket.readyState === WebSocket.OPEN) {
    lyriaSocket.send(
      JSON.stringify({
        action: 'set_prompts',
        prompts: weightedPrompts,
      })
    );
  }
}

// 6. Render Spectrum Visualizer & Main Animation Loop
function renderSpectrum() {
  const sw = spectrumCanvas.width;
  const sh = spectrumCanvas.height;
  spectrumCtx.clearRect(0, 0, sw, sh);

  const data = audioEngine.getSpectrumData();
  const barCount = 40;
  const barWidth = sw / barCount;

  for (let i = 0; i < barCount; i++) {
    const val = data[i] / 255;
    const barHeight = Math.max(4, val * (sh - 26));
    const x = i * barWidth;
    const y = sh - barHeight;
    const hue = (visionEngine.telemetry.dominantHue + i * 4) % 360;

    spectrumCtx.fillStyle = `hsla(${hue}, 92%, 62%, 0.88)`;
    spectrumCtx.fillRect(x + 1, y, barWidth - 2, barHeight);
  }
}

function animationLoop() {
  const spectrumData = audioEngine.getSpectrumData();
  const telemetry = visionEngine.updateAndRender(
    spectrumData,
    audioEngine.currentStep,
    audioEngine.currentChordLabel
  );
  steerMusicFromVision(telemetry);
  renderSpectrum();
  requestAnimationFrame(animationLoop);
}

// 7. Bind UI Controls
btnStartAll.addEventListener('click', async () => {
  if (!audioEngine.isPlaying) {
    if (!visionEngine.isRunning) {
      const camRes = await visionEngine.startWebcam();
      if (camRes.mode === 'simulated') {
        aiSceneText.textContent =
          'PCカメラが検出されなかったため、バーチャルカメラ・ステージ映像で音楽を生成しています（キャンバス上でマウスを動かすとジェスチャー操作が可能）。';
      }
    }
    await audioEngine.start();
    btnStartAll.classList.add('playing');
    btnStartAll.innerHTML = '<span class="btn-icon">⏸</span> 音楽を一時停止';
    liveBadge.classList.add('active');
    liveStatusText.textContent = 'LIVE PERFORMING';

    triggerFrameAnalysis();
    if (!autoAnalyzeInterval) {
      autoAnalyzeInterval = setInterval(() => {
        if (audioEngine.isPlaying && chkAutoGemini.checked) {
          triggerFrameAnalysis();
        }
      }, 6000);
    }
  } else {
    audioEngine.stop();
    btnStartAll.classList.remove('playing');
    btnStartAll.innerHTML = '<span class="btn-icon">▶</span> カメラ＆音楽スタート';
    liveBadge.classList.remove('active');
    liveStatusText.textContent = 'PAUSED';
  }
});

btnSimMode.addEventListener('click', async () => {
  const res = await visionEngine.toggleSimulatedMode();
  if (res.mode === 'simulated') {
    btnSimMode.textContent = '📷 PCカメラへ切替';
  } else {
    btnSimMode.textContent = '🎥 バーチャルカメラ切替';
  }
  triggerFrameAnalysis();
});

btnAnalyzeNow.addEventListener('click', () => {
  triggerFrameAnalysis();
});

// Viewport Tabs
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    visionEngine.viewMode = btn.dataset.view;
  });
});

// Sound World Presets
const PRESET_DEFAULTS = {
  keynote_techno: { bpm: 122, root: 'C', scale: 'dorian', reverb: 45, cutoff: 68 },
  lyria_ambient: { bpm: 96, root: 'F', scale: 'lydian', reverb: 78, cutoff: 58 },
  vegas_acid: { bpm: 132, root: 'E', scale: 'phrygian', reverb: 32, cutoff: 82 },
  sunset_lofi: { bpm: 92, root: 'D', scale: 'dorian', reverb: 52, cutoff: 46 },
};

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const preset = btn.dataset.preset;
    const cfg = PRESET_DEFAULTS[preset] || PRESET_DEFAULTS.keynote_techno;

    audioEngine.setParameters({
      preset,
      bpm: cfg.bpm,
      rootNote: cfg.root,
      scaleName: cfg.scale,
      reverbMix: cfg.reverb / 100,
      filterCutoffNorm: cfg.cutoff / 100,
    });

    sliderBpm.value = String(cfg.bpm);
    lblBpm.textContent = `${cfg.bpm} BPM`;
    selectRoot.value = cfg.root;
    selectScale.value = cfg.scale;
    sliderReverb.value = String(cfg.reverb);
    lblReverb.textContent = `${cfg.reverb}%`;
    sliderCutoff.value = String(cfg.cutoff);
    lblCutoff.textContent = `${cfg.cutoff}%`;

    triggerFrameAnalysis();
  });
});

// Track Mutes
document.querySelectorAll('.track-mute-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const track = btn.dataset.track;
    audioEngine.tracksEnabled[track] = !audioEngine.tracksEnabled[track];
    btn.classList.toggle('active', audioEngine.tracksEnabled[track]);
  });
});

btnTriggerDrop.addEventListener('click', () => {
  if (!audioEngine.isPlaying) {
    btnStartAll.click();
  }
  audioEngine.triggerDrop();
  renderSequencerGrid();
});

// Sliders
sliderBpm.addEventListener('input', (e) => {
  const v = Number(e.target.value);
  lblBpm.textContent = `${v} BPM`;
  audioEngine.setParameters({ bpm: v });
});

sliderCutoff.addEventListener('input', (e) => {
  const v = Number(e.target.value);
  lblCutoff.textContent = `${v}%`;
  audioEngine.setParameters({ filterCutoffNorm: v / 100 });
});

sliderReverb.addEventListener('input', (e) => {
  const v = Number(e.target.value);
  lblReverb.textContent = `${v}%`;
  audioEngine.setParameters({ reverbMix: v / 100 });
});

sliderArp.addEventListener('input', (e) => {
  const v = Number(e.target.value);
  lblArp.textContent = `${v}%`;
  audioEngine.setParameters({ arpDensity: v / 100 });
});

sliderVolume.addEventListener('input', (e) => {
  const v = Number(e.target.value);
  lblVolume.textContent = `${v}%`;
  audioEngine.setParameters({ masterVolume: v / 100 });
});

selectRoot.addEventListener('change', (e) => {
  audioEngine.setParameters({ rootNote: e.target.value });
});

selectScale.addEventListener('change', (e) => {
  audioEngine.setParameters({ scaleName: e.target.value });
});

// Modal
btnApiModal.addEventListener('click', () => {
  apiModalBackdrop.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
  apiModalBackdrop.classList.add('hidden');
});

btnSaveApi.addEventListener('click', () => {
  userApiKey = inputApiKey.value.trim();
  localStorage.setItem('nototoki_gemini_api_key', userApiKey);
  connectLyriaWebSocket();
  apiModalBackdrop.classList.add('hidden');
  triggerFrameAnalysis();
});

// Initialize on load
renderSequencerGrid();
renderWeightedPrompts();
visionEngine.startSimulatedCamera();
requestAnimationFrame(animationLoop);
