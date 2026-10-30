// Real-Time PC Camera + MediaPipe Hand Tracking + Shader Vibe VJ Visualizer

export class VisionEngine {
  constructor(videoEl, stageCanvas) {
    this.videoEl = videoEl;
    this.stageCanvas = stageCanvas;
    this.ctx = stageCanvas.getContext('2d');

    // Offscreen low-res canvas for fast pixel/motion/color analysis & JPEG snapshot
    this.analysisCanvas = document.createElement('canvas');
    this.analysisCanvas.width = 96;
    this.analysisCanvas.height = 54;
    this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });

    this.snapshotCanvas = document.createElement('canvas');
    this.snapshotCanvas.width = 384;
    this.snapshotCanvas.height = 216;
    this.snapshotCtx = this.snapshotCanvas.getContext('2d');

    this.prevFrameLuma = null;
    this.isRunning = false;
    this.isSimulated = false;
    this.viewMode = 'hybrid'; // 'hybrid' | 'camera' | 'shader'

    // Extracted real-time telemetry
    this.telemetry = {
      brightness: 0.52,
      motionEnergy: 0.25,
      dominantHue: 190,
      gestureMod: 0.3,
      handsCount: 0,
      leftHand: null,  // { x, y, pinch, open }
      rightHand: null, // { x, y, pinch, open }
      handSummary: '',
    };

    // Mouse / pointer interactive fallback
    this.pointer = {
      active: false,
      x: 0.5,
      y: 0.5,
      isDown: false,
    };

    this.handLandmarker = null;
    this.lastVideoTime = -1;
    this.simTime = 0;

    this._bindPointerEvents();
    this._initMediaPipeHands();
  }

  _bindPointerEvents() {
    const updatePos = (e) => {
      const rect = this.stageCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      this.pointer.x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.pointer.y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      this.pointer.active = true;
    };

    this.stageCanvas.addEventListener('mousemove', updatePos);
    this.stageCanvas.addEventListener('mousedown', (e) => {
      this.pointer.isDown = true;
      updatePos(e);
    });
    window.addEventListener('mouseup', () => {
      this.pointer.isDown = false;
    });
    this.stageCanvas.addEventListener('mouseleave', () => {
      this.pointer.active = false;
      this.pointer.isDown = false;
    });
  }

  async _initMediaPipeHands() {
    try {
      const visionModule = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
      );
      const { FilesetResolver, HandLandmarker } = visionModule;
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      console.info('MediaPipe HandLandmarker initialized.');
    } catch (err) {
      console.warn('MediaPipe HandLandmarker unavailable, using optical + pointer gesture mode:', err);
    }
  }

  async startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      this.videoEl.srcObject = stream;
      await this.videoEl.play();
      this.isSimulated = false;
      this.isRunning = true;
      return { ok: true, mode: 'webcam' };
    } catch (err) {
      console.warn('Webcam unavailable or permission denied, switching to Virtual Camera mode:', err);
      this.startSimulatedCamera();
      return { ok: true, mode: 'simulated', reason: err.message };
    }
  }

  startSimulatedCamera() {
    if (this.videoEl.srcObject) {
      const tracks = this.videoEl.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
      this.videoEl.srcObject = null;
    }
    this.isSimulated = true;
    this.isRunning = true;
  }

  toggleSimulatedMode() {
    if (this.isSimulated) {
      return this.startWebcam();
    } else {
      this.startSimulatedCamera();
      return Promise.resolve({ ok: true, mode: 'simulated' });
    }
  }

  _drawSimulatedScene(targetCtx, width, height, t) {
    // Procedural cyber-stage virtual camera scene with animated dancers/hands/color orbs
    const hueBase = (t * 18) % 360;
    const grad = targetCtx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, `hsl(${hueBase}, 68%, 16%)`);
    grad.addColorStop(0.5, `hsl(${(hueBase + 65) % 360}, 65%, 24%)`);
    grad.addColorStop(1, `hsl(${(hueBase + 140) % 360}, 75%, 14%)`);
    targetCtx.fillStyle = grad;
    targetCtx.fillRect(0, 0, width, height);

    // Moving luminous orbs simulating objects & motion in front of camera
    for (let i = 0; i < 5; i++) {
      const angle = t * (0.7 + i * 0.25) + i * 1.4;
      const cx = width * (0.5 + 0.34 * Math.cos(angle));
      const cy = height * (0.5 + 0.28 * Math.sin(angle * 1.3));
      const radius = Math.min(width, height) * (0.12 + 0.04 * Math.sin(t * 2 + i));

      const orbGrad = targetCtx.createRadialGradient(cx, cy, 2, cx, cy, radius);
      const orbHue = (hueBase + i * 55) % 360;
      orbGrad.addColorStop(0, `hsla(${orbHue}, 95%, 72%, 0.9)`);
      orbGrad.addColorStop(0.5, `hsla(${orbHue}, 90%, 55%, 0.45)`);
      orbGrad.addColorStop(1, `hsla(${orbHue}, 90%, 40%, 0)`);

      targetCtx.fillStyle = orbGrad;
      targetCtx.beginPath();
      targetCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      targetCtx.fill();
    }

    // Silhouette performer in center
    targetCtx.save();
    targetCtx.fillStyle = 'rgba(12, 16, 28, 0.55)';
    targetCtx.beginPath();
    targetCtx.arc(width * 0.5, height * 0.42, height * 0.13, 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.beginPath();
    targetCtx.ellipse(width * 0.5, height * 0.78, width * 0.18, height * 0.24, 0, Math.PI, 0);
    targetCtx.fill();
    targetCtx.restore();
  }

  updateAndRender(spectrumData, currentStep, currentChord) {
    this.simTime += 0.025;
    const w = this.stageCanvas.width;
    const h = this.stageCanvas.height;

    // 1. Draw current video/simulated source into low-res analysis canvas
    const aw = this.analysisCanvas.width;
    const ah = this.analysisCanvas.height;

    if (!this.isSimulated && this.videoEl.readyState >= 2) {
      this.analysisCtx.save();
      this.analysisCtx.translate(aw, 0);
      this.analysisCtx.scale(-1, 1);
      this.analysisCtx.drawImage(this.videoEl, 0, 0, aw, ah);
      this.analysisCtx.restore();
    } else {
      this._drawSimulatedScene(this.analysisCtx, aw, ah, this.simTime);
    }

    // 2. Analyze pixels for Brightness, Motion Energy, and Dominant Hue
    const imgData = this.analysisCtx.getImageData(0, 0, aw, ah).data;
    const pixelCount = aw * ah;
    if (!this.prevFrameLuma) {
      this.prevFrameLuma = new Float32Array(pixelCount);
    }

    let totalLuma = 0;
    let totalMotion = 0;
    let sumSinHue = 0;
    let sumCosHue = 0;
    let chromaWeightSum = 0;

    for (let i = 0; i < pixelCount; i++) {
      const r = imgData[i * 4] / 255;
      const g = imgData[i * 4 + 1] / 255;
      const b = imgData[i * 4 + 2] / 255;

      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLuma += luma;

      const diff = Math.abs(luma - this.prevFrameLuma[i]);
      if (diff > 0.035) {
        totalMotion += diff;
      }
      this.prevFrameLuma[i] = luma;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta > 0.08) {
        let hue = 0;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;

        const rad = (hue * Math.PI) / 180;
        sumCosHue += Math.cos(rad) * delta;
        sumSinHue += Math.sin(rad) * delta;
        chromaWeightSum += delta;
      }
    }

    const avgBrightness = totalLuma / pixelCount;
    const rawMotion = Math.min(1.0, (totalMotion / pixelCount) * 6.5);

    let dominantHue = this.telemetry.dominantHue;
    if (chromaWeightSum > 0.5) {
      let avgAngle = (Math.atan2(sumSinHue, sumCosHue) * 180) / Math.PI;
      if (avgAngle < 0) avgAngle += 360;
      dominantHue = avgAngle;
    }

    // Smooth telemetry values
    this.telemetry.brightness = this.telemetry.brightness * 0.82 + avgBrightness * 0.18;
    this.telemetry.motionEnergy = this.telemetry.motionEnergy * 0.78 + rawMotion * 0.22;
    this.telemetry.dominantHue = dominantHue;

    // 3. Detect MediaPipe Hands (or synthesize virtual/pointer hands)
    this._updateHandTracking();

    // 4. Render composite Stage Canvas
    this._renderStage(w, h, spectrumData, currentStep, currentChord);

    return this.telemetry;
  }

  _updateHandTracking() {
    let detectedHands = [];

    if (!this.isSimulated && this.handLandmarker && this.videoEl.readyState >= 2) {
      const nowMs = performance.now();
      if (this.videoEl.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoEl.currentTime;
        try {
          const result = this.handLandmarker.detectForVideo(this.videoEl, nowMs);
          if (result && result.landmarks) {
            detectedHands = result.landmarks.map((landmarks) => {
              // Mirror X coordinate so it matches the mirrored webcam display
              const mirrored = landmarks.map((pt) => ({
                x: 1 - pt.x,
                y: pt.y,
                z: pt.z,
              }));
              const wrist = mirrored[0];
              const thumbTip = mirrored[4];
              const indexTip = mirrored[8];
              const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
              const pinchNorm = Math.max(0, Math.min(1, 1 - (pinchDist - 0.03) / 0.18));
              return {
                x: indexTip.x,
                y: indexTip.y,
                wristX: wrist.x,
                wristY: wrist.y,
                pinch: pinchNorm,
                landmarks: mirrored,
              };
            });
          }
        } catch (e) {
          // Ignore single-frame detection errors
        }
      }
    }

    if (detectedHands.length > 0) {
      this.telemetry.handsCount = detectedHands.length;
      // Sort by X position on screen: left half vs right half
      let left = null;
      let right = null;
      for (const h of detectedHands) {
        if (h.x < 0.5) left = h;
        else right = h;
      }
      this.telemetry.leftHand = left;
      this.telemetry.rightHand = right;

      const pinchAvg =
        detectedHands.reduce((acc, h) => acc + h.pinch, 0) / detectedHands.length;
      this.telemetry.gestureMod = this.telemetry.gestureMod * 0.7 + pinchAvg * 0.3;

      const parts = [];
      if (left) parts.push(`左手Y:${Math.round((1 - left.y) * 100)}% Pinch:${Math.round(left.pinch * 100)}%`);
      if (right) parts.push(`右手Y:${Math.round((1 - right.y) * 100)}% Pinch:${Math.round(right.pinch * 100)}%`);
      this.telemetry.handSummary = parts.join(' / ');
    } else if (this.pointer.active) {
      this.telemetry.handsCount = 1;
      const virtualPinch = this.pointer.isDown ? 0.92 : 0.35;
      if (this.pointer.x < 0.5) {
        this.telemetry.leftHand = {
          x: this.pointer.x,
          y: this.pointer.y,
          pinch: virtualPinch,
          landmarks: null,
        };
        this.telemetry.rightHand = null;
      } else {
        this.telemetry.rightHand = {
          x: this.pointer.x,
          y: this.pointer.y,
          pinch: virtualPinch,
          landmarks: null,
        };
        this.telemetry.leftHand = null;
      }
      this.telemetry.gestureMod = this.telemetry.gestureMod * 0.8 + virtualPinch * 0.2;
      this.telemetry.handSummary = `ポインター操作 X:${Math.round(this.pointer.x * 100)}% Y:${Math.round((1 - this.pointer.y) * 100)}%`;
    } else if (this.isSimulated) {
      // Animated virtual hands in simulated mode so the user sees the Future VJ gesture controller in action
      this.telemetry.handsCount = 2;
      const ly = 0.48 + 0.24 * Math.sin(this.simTime * 0.9);
      const ry = 0.45 + 0.26 * Math.cos(this.simTime * 1.15);
      const lPinch = 0.5 + 0.4 * Math.sin(this.simTime * 1.7);
      const rPinch = 0.5 + 0.4 * Math.cos(this.simTime * 2.1);

      this.telemetry.leftHand = {
        x: 0.26 + 0.08 * Math.cos(this.simTime * 0.7),
        y: ly,
        pinch: lPinch,
        landmarks: null,
      };
      this.telemetry.rightHand = {
        x: 0.74 + 0.08 * Math.sin(this.simTime * 0.8),
        y: ry,
        pinch: rPinch,
        landmarks: null,
      };
      this.telemetry.gestureMod = (lPinch + rPinch) * 0.5;
      this.telemetry.handSummary = `Virtual Hands L:${Math.round((1 - ly) * 100)}% R:${Math.round((1 - ry) * 100)}%`;
    } else {
      this.telemetry.handsCount = 0;
      this.telemetry.leftHand = null;
      this.telemetry.rightHand = null;
      this.telemetry.handSummary = '';
    }
  }

  _renderStage(w, h, spectrumData, currentStep, currentChord) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Step A: Draw Camera Base Layer (if viewMode is 'hybrid' or 'camera')
    if (this.viewMode !== 'shader') {
      ctx.save();
      if (!this.isSimulated && this.videoEl.readyState >= 2) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(this.videoEl, 0, 0, w, h);
      } else {
        this._drawSimulatedScene(ctx, w, h, this.simTime);
      }
      ctx.restore();

      if (this.viewMode === 'hybrid') {
        // Darken slightly so Shader Vibe overlays pop with high contrast
        ctx.fillStyle = 'rgba(6, 9, 20, 0.44)';
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      // Full Shader Vibe background
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 20, w * 0.5, h * 0.5, w * 0.7);
      bgGrad.addColorStop(0, `hsla(${this.telemetry.dominantHue}, 75%, 16%, 1)`);
      bgGrad.addColorStop(1, '#04060d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // Step B: Render "Shader Vibe VJ" Geometry Overlay (if 'hybrid' or 'shader')
    if (this.viewMode === 'hybrid' || this.viewMode === 'shader') {
      this._renderShaderVibeOverlay(ctx, w, h, spectrumData, currentStep);
    }

    // Step C: Render MediaPipe Hand Skeleton & Gesture Control Rings
    this._renderHandOverlays(ctx, w, h);

    // Step D: Subtle stage grid & chord watermark
    ctx.save();
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(0, 229, 255, 0.75)';
    ctx.fillText(
      `MODE: ${this.isSimulated ? 'VIRTUAL CAMERA SIM' : 'LIVE PC CAMERA'} // STEP ${String(currentStep + 1).padStart(2, '0')} // ${currentChord}`,
      18,
      78
    );
    ctx.restore();
  }

  _renderShaderVibeOverlay(ctx, w, h, spectrumData, currentStep) {
    const hue = this.telemetry.dominantHue;
    const motion = this.telemetry.motionEnergy;
    const leftY = this.telemetry.leftHand ? 1 - this.telemetry.leftHand.y : this.telemetry.brightness;
    const rightY = this.telemetry.rightHand ? 1 - this.telemetry.rightHand.y : 0.5;

    let bassEnergy = 0;
    if (spectrumData && spectrumData.length > 8) {
      for (let i = 0; i < 8; i++) bassEnergy += spectrumData[i];
      bassEnergy = bassEnergy / (8 * 255);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Sacred geometry reactive rings in center
    const cx = w * 0.5;
    const cy = h * 0.5;
    const baseRadius = Math.min(w, h) * (0.16 + bassEnergy * 0.14 + motion * 0.08);
    const sides = Math.max(3, Math.min(12, Math.round(3 + leftY * 7)));

    for (let ring = 0; ring < 4; ring++) {
      const r = baseRadius * (0.55 + ring * 0.34);
      const rot = this.simTime * (ring % 2 === 0 ? 0.6 : -0.45) + ring * 0.4;
      const ringHue = (hue + ring * 38 + rightY * 90) % 360;

      ctx.strokeStyle = `hsla(${ringHue}, 95%, 65%, ${0.52 - ring * 0.09})`;
      ctx.lineWidth = 2.2 - ring * 0.3;
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const theta = rot + (i * Math.PI * 2) / sides;
        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Audio-reactive radial spectrum bars around center
    if (spectrumData && spectrumData.length > 0) {
      const bins = 36;
      for (let i = 0; i < bins; i++) {
        const val = spectrumData[i] / 255;
        const angle = (i / bins) * Math.PI * 2 + this.simTime * 0.25;
        const rInner = baseRadius * 0.45;
        const rOuter = rInner + val * (Math.min(w, h) * 0.22);

        ctx.strokeStyle = `hsla(${(hue + i * 6) % 360}, 95%, 68%, ${0.25 + val * 0.65})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
        ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _renderHandOverlays(ctx, w, h) {
    const drawHandNode = (hand, color, label) => {
      if (!hand) return;
      const hx = hand.x * w;
      const hy = hand.y * h;

      ctx.save();
      // Draw 21 landmarks if real MediaPipe hand is present
      if (hand.landmarks) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const chains = [
          [0, 1, 2, 3, 4],
          [0, 5, 6, 7, 8],
          [0, 9, 10, 11, 12],
          [0, 13, 14, 15, 16],
          [0, 17, 18, 19, 20],
        ];
        for (const chain of chains) {
          ctx.beginPath();
          chain.forEach((idx, i) => {
            const pt = hand.landmarks[idx];
            if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
            else ctx.lineTo(pt.x * w, pt.y * h);
          });
          ctx.stroke();
        }
        for (const pt of hand.landmarks) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pt.x * w, pt.y * h, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw glowing control reticle around hand position
      const ringRadius = 26 + hand.pinch * 28;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(hx, hy, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillText(
        `${label} [Y:${Math.round((1 - hand.y) * 100)}% PINCH:${Math.round(hand.pinch * 100)}%]`,
        hx - 55,
        hy - ringRadius - 8
      );
      ctx.restore();
    };

    drawHandNode(this.telemetry.leftHand, '#00e5ff', 'L-CTRL (FILTER/CHORD)');
    drawHandNode(this.telemetry.rightHand, '#ff2a85', 'R-CTRL (ARP/PULSE)');
  }

  captureJpegBase64() {
    const sw = this.snapshotCanvas.width;
    const sh = this.snapshotCanvas.height;
    if (!this.isSimulated && this.videoEl.readyState >= 2) {
      this.snapshotCtx.drawImage(this.videoEl, 0, 0, sw, sh);
    } else {
      this._drawSimulatedScene(this.snapshotCtx, sw, sh, this.simTime);
    }
    return this.snapshotCanvas.toDataURL('image/jpeg', 0.78);
  }
}
