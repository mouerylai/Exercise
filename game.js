"use strict";

const CONFIG = {
  WIDTH: 1280,
  HEIGHT: 720,
  MAX_PITCHES: 10,
  GROUND_Y: 588,
  CONTACT_X: 342,
  CONTACT_Y: 470,
  CATCHER_X: 120,
  PITCHER_X: 1015,
  PITCH_START_X: 925,
  PITCH_START_Y: 470,
  PITCH_SPEED: 530,
  PERFECT_WINDOW: 18,
  GOOD_WINDOW: 48,
  WEAK_WINDOW: 92,
  GRAVITY: 1180,
  BOUNCE_DAMPING: 0.58,
  GROUND_FRICTION: 0.91,
  AIR_DRAG: 0.998,
  CAMERA_FOLLOW_SMOOTHING: 5.5,
  SCORE_MULTIPLIER: 0.075,
  READY_SECONDS: 0.82,
  RESULT_SECONDS: 1.45,
  PITCH_RELEASE_TIME: 0.58,
  SWING_SECONDS: 0.44,
  CATCHER_RECEIVE_X: 222,
  CATCHER_GLOVE_Y: 470,
  PITCHER_SPRITE_HEIGHT: 300,
  BATTER_SPRITE_HEIGHT: 300,
  CATCHER_SPRITE_HEIGHT: 255,
  BALL_SPRITE_SIZE: 38,
};

const GameState = Object.freeze({
  TITLE: "TITLE",
  READY: "READY",
  PITCHING: "PITCHING",
  SWING_RESOLVED: "SWING_RESOLVED",
  BALL_IN_FLIGHT: "BALL_IN_FLIGHT",
  ROUND_OVER: "ROUND_OVER",
});

const BallMode = Object.freeze({
  HELD: "HELD",
  PITCH: "PITCH",
  HIT: "HIT",
  STOPPED: "STOPPED",
});

const HIT_PROFILES = {
  Perfect: { vx: 2000, vy: -725, scoreBonus: 1.25, color: "#ff6a4b" },
  Good: { vx: 1500, vy: -610, scoreBonus: 1.0, color: "#ffb23e" },
  Weak: { vx: 800, vy: -390, scoreBonus: 0.62, color: "#78b7ff" },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function easeInOut(t) {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}

class AssetLoader {
  constructor() {
    this.images = {
      background: this.loadImage("background-field.jpg"),
      cat: this.loadImage("Cat-Korean-Cartoon.png"),
    };
    this.pitcherFrames = this.loadSpriteSequence("pitcher", 5);
    this.batterFrames = this.loadSpriteSequence("batter", 4);
    this.catcherFrames = [
      "images/catcher-01.png",
      "images/catcher-02-a.png",
      "images/catcher-03.png",
      "images/catcher-04.png",
    ].map((src) => this.loadSpriteFrame(src));
    this.ballSprite = this.loadSpriteFrame("images/ball.png");
  }

  loadImage(src) {
    const image = new Image();
    image.loaded = false;
    image.addEventListener("load", () => {
      image.loaded = true;
    });
    image.addEventListener("error", () => {
      image.loaded = false;
    });
    image.src = src;
    return image;
  }

  loadSpriteSequence(prefix, count) {
    const frames = [];
    for (let i = 1; i <= count; i += 1) {
      frames.push(this.loadSpriteFrame("images/" + prefix + "-" + String(i).padStart(2, "0") + ".png"));
    }
    return frames;
  }

  loadSpriteFrame(src) {
    const frame = {
      src,
      image: new Image(),
      canvas: null,
      bounds: null,
      loaded: false,
      failed: false,
    };

    frame.image.addEventListener("load", () => {
      try {
        this.prepareSpriteFrame(frame);
      } catch (error) {
        frame.failed = true;
        frame.loaded = false;
        console.warn("Sprite cleanup failed:", src, error);
      }
    });
    frame.image.addEventListener("error", () => {
      frame.failed = true;
      frame.loaded = false;
    });
    frame.image.src = src;
    return frame;
  }

  loadPitcherFrame(src) {
    return this.loadSpriteFrame(src);
  }

  get pitcherReady() {
    return this.sequenceReady(this.pitcherFrames);
  }

  get batterReady() {
    return this.sequenceReady(this.batterFrames);
  }

  get catcherReady() {
    return this.sequenceReady(this.catcherFrames);
  }

  get ballReady() {
    return Boolean(this.ballSprite.loaded && this.ballSprite.canvas && this.ballSprite.bounds);
  }

  sequenceReady(frames) {
    return frames.every((frame) => frame.loaded && frame.canvas && frame.bounds);
  }

  prepareSpriteFrame(frame) {
    const source = frame.image;
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.clearBorderCheckerboard(imageData);
    const bounds = this.findVisibleBounds(imageData);
    ctx.putImageData(imageData, 0, 0);

    frame.canvas = canvas;
    frame.bounds = bounds;
    frame.loaded = Boolean(bounds);
    frame.failed = !frame.loaded;
  }

  preparePitcherFrame(frame) {
    this.prepareSpriteFrame(frame);
  }

  clearBorderCheckerboard(imageData) {
    const { width, height, data } = imageData;
    const visited = new Uint8Array(width * height);
    const queue = [];
    let head = 0;

    const enqueue = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }
      const index = y * width + x;
      if (visited[index]) {
        return;
      }
      visited[index] = 1;
      if (!this.isCheckerboardPixel(data, index * 4)) {
        return;
      }
      queue.push(index);
      data[index * 4 + 3] = 0;
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (head < queue.length) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  isCheckerboardPixel(data, offset) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return min >= 226 && max - min <= 12;
  }

  findVisibleBounds(imageData) {
    const { width, height, data } = imageData;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }
}

class AudioManager {
  constructor(button) {
    this.button = button;
    this.context = null;
    this.master = null;
    this.muted = false;
    this.unlocked = false;
    this.updateButton();
  }

  unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.muted = true;
        this.updateButton();
        return;
      }
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      this.context.resume();
    }
    this.unlocked = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.updateButton();
  }

  updateButton() {
    if (!this.button) {
      return;
    }
    this.button.textContent = this.muted ? "Sound Off" : "Sound On";
    this.button.classList.toggle("is-muted", this.muted);
    this.button.setAttribute("aria-pressed", String(this.muted));
  }

  play(name) {
    if (this.muted) {
      return;
    }
    this.unlock();
    if (!this.context || !this.master) {
      return;
    }

    const sounds = {
      start: () => this.chime([440, 660, 880], 0.1, "triangle", 0.22),
      pitch: () => this.sweep(260, 560, 0.16, "sine", 0.13),
      swing: () => this.noiseBurst(0.08, 0.16),
      perfect: () => this.chime([660, 990, 1320], 0.12, "square", 0.22),
      good: () => this.chime([520, 760, 1040], 0.1, "triangle", 0.18),
      weak: () => this.chime([300, 410], 0.1, "sine", 0.15),
      miss: () => this.sweep(220, 120, 0.14, "sawtooth", 0.12),
      catch: () => this.noiseBurst(0.06, 0.12),
      bounce: () => this.sweep(180, 90, 0.08, "sine", 0.08),
      roundOver: () => this.chime([392, 523, 659, 784], 0.16, "triangle", 0.2),
    };

    if (sounds[name]) {
      sounds[name]();
    }
  }

  chime(frequencies, noteLength, type, volume) {
    frequencies.forEach((frequency, index) => {
      const start = this.context.currentTime + index * noteLength * 0.72;
      this.tone(frequency, start, noteLength, type, volume);
    });
  }

  sweep(from, to, duration, type, volume) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  tone(frequency, start, duration, type, volume) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  noiseBurst(duration, volume) {
    const now = this.context.currentTime;
    const bufferSize = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 950;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
  }
}

class InputController {
  constructor(game, canvas, button, muteButton) {
    this.game = game;
    this.canvas = canvas;
    this.button = button;
    this.muteButton = muteButton;

    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.game.handlePrimaryAction();
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.game.handlePrimaryAction();
    });

    muteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.game.audio.toggleMute();
    });
  }
}

class ScoreSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentPitch = 0;
    this.totalScore = 0;
    this.latestScore = 0;
    this.latestResult = "Ready";
    this.history = [];
  }

  beginPitch() {
    this.currentPitch += 1;
    this.latestScore = 0;
    this.latestResult = "Pitch " + this.currentPitch;
  }

  record(result, score, distance) {
    this.latestResult = result;
    this.latestScore = score;
    this.totalScore += score;
    this.history.push({ pitch: this.currentPitch, result, score, distance });
  }

  isRoundComplete() {
    return this.currentPitch >= CONFIG.MAX_PITCHES;
  }

  displayPitch(state) {
    if (state === GameState.TITLE) {
      return 0;
    }
    if (state === GameState.READY) {
      return clamp(this.currentPitch + 1, 1, CONFIG.MAX_PITCHES);
    }
    return clamp(this.currentPitch, 1, CONFIG.MAX_PITCHES);
  }
}

class Camera {
  constructor() {
    this.x = 0;
    this.following = false;
  }

  reset() {
    this.x = 0;
    this.following = false;
  }

  update(dt, ball) {
    if (ball.mode === BallMode.HIT && ball.x - this.x > CONFIG.WIDTH * 0.5) {
      this.following = true;
    }

    if (!this.following) {
      this.x = lerp(this.x, 0, clamp(dt * CONFIG.CAMERA_FOLLOW_SMOOTHING, 0, 1));
      return;
    }

    const target = Math.max(0, ball.x - CONFIG.WIDTH * 0.5);
    this.x = lerp(this.x, target, clamp(dt * CONFIG.CAMERA_FOLLOW_SMOOTHING, 0, 1));
  }
}

class Ball {
  constructor() {
    this.radius = 9;
    this.resetHeld();
  }

  resetHeld() {
    this.mode = BallMode.HELD;
    this.x = CONFIG.PITCH_START_X;
    this.y = CONFIG.PITCH_START_Y;
    this.vx = 0;
    this.vy = 0;
    this.visible = false;
    this.hitStartX = this.x;
    this.distance = 0;
    this.bounceCount = 0;
    this.stopTimer = 0;
    this.spinAngle = 0;
    this.spinSpeed = 0;
  }

  startPitch() {
    this.mode = BallMode.PITCH;
    this.x = CONFIG.PITCH_START_X;
    this.y = CONFIG.PITCH_START_Y;
    this.vx = -CONFIG.PITCH_SPEED;
    this.vy = 0;
    this.visible = true;
    this.spinSpeed = -58;
  }

  launch(profile) {
    this.mode = BallMode.HIT;
    this.hitStartX = CONFIG.CONTACT_X;
    this.x = CONFIG.CONTACT_X + 5;
    this.y = CONFIG.CONTACT_Y;
    this.vx = profile.vx;
    this.vy = profile.vy;
    this.distance = 0;
    this.bounceCount = 0;
    this.stopTimer = 0;
    this.spinSpeed = 38 + profile.vx * 0.025;
  }

  updatePitch(dt, pitchTime) {
    if (this.mode !== BallMode.PITCH) {
      return;
    }

    this.x += this.vx * dt;
    this.spinAngle += this.spinSpeed * dt;
    const progress = clamp((CONFIG.PITCH_START_X - this.x) / (CONFIG.PITCH_START_X - CONFIG.CATCHER_RECEIVE_X), 0, 1);
    const readableFloat = Math.sin(progress * Math.PI) * 2;
    this.y = lerp(CONFIG.PITCH_START_Y, CONFIG.CATCHER_GLOVE_Y, easeInOut(progress)) - readableFloat;
  }

  updateHit(dt) {
    if (this.mode !== BallMode.HIT) {
      return [];
    }

    const effects = [];
    this.vy += CONFIG.GRAVITY * dt;
    this.vx *= Math.pow(CONFIG.AIR_DRAG, dt * 60);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spinAngle += this.spinSpeed * dt;
    this.spinSpeed *= Math.pow(0.994, dt * 60);
    this.distance = Math.max(0, this.x - this.hitStartX);

    if (this.y + this.radius >= CONFIG.GROUND_Y) {
      this.y = CONFIG.GROUND_Y - this.radius;
      if (Math.abs(this.vy) > 90) {
        this.vy = -Math.abs(this.vy) * CONFIG.BOUNCE_DAMPING;
        this.vx *= CONFIG.GROUND_FRICTION;
        this.spinSpeed *= 0.72;
        this.bounceCount += 1;
        effects.push({ type: "dust", x: this.x, y: CONFIG.GROUND_Y, life: 0.55 });
      } else {
        this.vy = 0;
        this.vx *= Math.pow(0.62, dt * 60);
        this.spinSpeed = lerp(this.spinSpeed, this.vx * 0.06, clamp(dt * 10, 0, 1));
      }
    }

    if (Math.abs(this.vx) < 18 && Math.abs(this.vy) < 30 && this.y + this.radius >= CONFIG.GROUND_Y - 1) {
      this.stopTimer += dt;
    } else {
      this.stopTimer = 0;
    }

    if (this.stopTimer > 0.35 || this.distance > 16000) {
      this.mode = BallMode.STOPPED;
      this.vx = 0;
      this.vy = 0;
    }

    return effects;
  }
}

class HitEvaluator {
  static evaluate(ball) {
    const offset = ball.x - CONFIG.CONTACT_X;
    const timingError = Math.abs(offset);

    if (timingError <= CONFIG.PERFECT_WINDOW) {
      return { result: "Perfect", profile: HIT_PROFILES.Perfect, timingError };
    }
    if (timingError <= CONFIG.GOOD_WINDOW) {
      return { result: "Good", profile: HIT_PROFILES.Good, timingError };
    }
    if (timingError <= CONFIG.WEAK_WINDOW) {
      const early = offset > 0;
      const profile = {
        ...HIT_PROFILES.Weak,
        vx: HIT_PROFILES.Weak.vx + (early ? 30 : -40),
        vy: HIT_PROFILES.Weak.vy + (early ? 35 : -15),
      };
      return { result: early ? "Early Weak" : "Late Weak", profile, timingError };
    }
    return { result: "Miss", profile: null, timingError };
  }
}

class PitchController {
  constructor(ball) {
    this.ball = ball;
    this.reset();
  }

  reset() {
    this.time = 0;
    this.swingAttempted = false;
    this.swingTimer = 0;
    this.pitchStarted = false;
    this.pitcherState = "idle";
    this.catcherState = "idle";
    this.catcherTimer = 0;
    this.releasePulse = 0;
    this.pendingMiss = false;
    this.missTextShown = false;
  }

  startPitch() {
    this.reset();
    this.ball.resetHeld();
    this.pitcherState = "windup";
  }

  swing() {
    this.swingAttempted = true;
    this.swingTimer = CONFIG.SWING_SECONDS;
  }

  receive() {
    this.catcherState = "receive";
    this.catcherTimer = 0.34;
  }

  markMiss() {
    this.pendingMiss = true;
  }

  getPitcherProgress() {
    return clamp(this.time / 1.02, 0, 1);
  }

  getSwingProgress() {
    if (this.swingTimer <= 0) {
      return 0;
    }
    return 1 - this.swingTimer / CONFIG.SWING_SECONDS;
  }

  getCatcherProgress() {
    if (this.catcherTimer <= 0) {
      return 0;
    }
    return 1 - this.catcherTimer / 0.34;
  }

  updatePoseTimers(dt) {
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.catcherTimer = Math.max(0, this.catcherTimer - dt);
    this.releasePulse = Math.max(0, this.releasePulse - dt);
    if (this.catcherTimer <= 0 && this.catcherState === "receive") {
      this.catcherState = "idle";
    }
  }

  update(dt) {
    const events = [];
    this.time += dt;
    this.updatePoseTimers(dt);

    if (!this.pitchStarted && this.time >= CONFIG.PITCH_RELEASE_TIME) {
      this.pitchStarted = true;
      this.pitcherState = "throw";
      this.ball.startPitch();
      this.releasePulse = 0.16;
      events.push("pitchRelease");
    }

    if (this.pitchStarted) {
      this.ball.updatePitch(dt, this.time);
    }

    if (this.time > 1.02) {
      this.pitcherState = "idle";
    }

    return events;
  }
}

class FloatingText {
  constructor(text, x, y, color, size = 34) {
    this.text = text;
    this.x = x;
    this.y = y;
    this.color = color;
    this.size = size;
    this.life = 1.05;
    this.maxLife = 1.05;
  }

  update(dt) {
    this.life -= dt;
    this.y -= 38 * dt;
  }

  get alive() {
    return this.life > 0;
  }
}

class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
  }

  render(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    this.drawBackground(ctx, game.camera.x);
    this.drawWorld(ctx, game);
    this.drawHud(ctx, game);
    if (game.state === GameState.TITLE) {
      this.drawTitleHint(ctx);
    }
  }

  drawBackground(ctx, cameraX) {
    const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.HEIGHT * 0.72);
    sky.addColorStop(0, "#aee0ff");
    sky.addColorStop(0.55, "#e9f8ff");
    sky.addColorStop(1, "#fff6ce");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

    this.drawSun(ctx, 958, 78);

    this.drawParallaxRepeats(ctx, cameraX, 0.08, 620, -1, 4, (x, index) => {
      this.drawCloud(ctx, x + 80, 106 + Math.sin(index) * 18, 1.05);
      this.drawCloud(ctx, x + 395, 150 + Math.cos(index) * 12, 0.82);
    });

    this.drawHillBand(ctx, cameraX, 0.08, 292, "#d9efbd", 0);
    this.drawHillBand(ctx, cameraX, 0.13, 342, "#bfe38d", 1);
    this.drawTreeBand(ctx, cameraX, 0.18);

    const farGrass = ctx.createLinearGradient(0, 372, 0, 450);
    farGrass.addColorStop(0, "rgb(172 221 117 / 0.25)");
    farGrass.addColorStop(0.45, "#9bd85a");
    farGrass.addColorStop(1, "#8fd14f");
    ctx.fillStyle = farGrass;
    ctx.beginPath();
    ctx.moveTo(0, 394);
    ctx.bezierCurveTo(260, 366, 474, 420, 720, 382);
    ctx.bezierCurveTo(956, 344, 1108, 398, 1280, 362);
    ctx.lineTo(CONFIG.WIDTH, 468);
    ctx.lineTo(0, 468);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(-cameraX * 0.35, 0);
    for (let i = -2; i < 8; i += 1) {
      const x = i * 430;
      ctx.fillStyle = i % 2 === 0 ? "#9bd85a" : "#8fd14f";
      ctx.beginPath();
      ctx.moveTo(x - 80, 438);
      ctx.bezierCurveTo(x + 90, 382, x + 275, 446, x + 460, 397);
      ctx.bezierCurveTo(x + 610, 365, x + 705, 430, x + 840, 391);
      ctx.lineTo(x + 840, CONFIG.HEIGHT);
      ctx.lineTo(x - 80, CONFIG.HEIGHT);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(-cameraX * 0.75, 0);
    ctx.fillStyle = "#78c447";
    ctx.fillRect(cameraX * 0.75 - 20, CONFIG.GROUND_Y, CONFIG.WIDTH + 40, CONFIG.HEIGHT - CONFIG.GROUND_Y);
    for (let i = -2; i < 12; i += 1) {
      const x = i * 360;
      ctx.fillStyle = "#d9bd76";
      ctx.beginPath();
      ctx.ellipse(x + 350, CONFIG.GROUND_Y + 10, 190, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawBush(ctx, x + 65, 496, 0.62);
      this.drawBush(ctx, x + 275, 514, 0.48);
      this.drawFlower(ctx, x + 136, 614, "#f58bc1");
      this.drawFlower(ctx, x + 190, 626, "#fff6a7");
      this.drawFlower(ctx, x + 238, 610, "#8bd4ff");
      this.drawDistanceMarker(ctx, x + 322, CONFIG.GROUND_Y - 18, Math.max(0, Math.round((i * 360) / 10)));
    }
    ctx.restore();
  }

  drawParallaxRepeats(ctx, cameraX, factor, width, start, count, draw) {
    const offset = cameraX * factor;
    for (let i = start; i < count; i += 1) {
      const x = i * width - (offset % width);
      draw(x, i);
    }
  }

  drawHillBand(ctx, cameraX, factor, baseY, color, phase) {
    ctx.save();
    const width = 1560;
    const offset = (cameraX * factor) % width;
    for (let i = -1; i < 3; i += 1) {
      const x = i * width - offset;
      const y = baseY + Math.sin((i + phase) * 1.7) * 6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 140, y + 96);
      ctx.bezierCurveTo(x + 90, y + 8, x + 260, y + 78, x + 455, y + 16);
      ctx.bezierCurveTo(x + 650, y - 42, x + 810, y + 78, x + 1040, y + 10);
      ctx.bezierCurveTo(x + 1245, y - 48, x + 1380, y + 68, x + 1700, y + 18);
      ctx.lineTo(x + 1700, CONFIG.HEIGHT);
      ctx.lineTo(x - 140, CONFIG.HEIGHT);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgb(255 255 255 / 0.28)";
      ctx.beginPath();
      ctx.ellipse(x + 632, y + 6, 58, 8, -0.1, 0, Math.PI * 2);
      ctx.ellipse(x + 1290, y + 18, 42, 7, 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTreeBand(ctx, cameraX, factor) {
    ctx.save();
    const width = 1320;
    const offset = (cameraX * factor) % width;
    for (let tile = -1; tile < 3; tile += 1) {
      const baseX = tile * width - offset;
      for (let i = 0; i < 16; i += 1) {
        const seed = tile * 19 + i * 7;
        const x = baseX + i * 88 + Math.sin(seed) * 22;
        const y = 374 + Math.cos(seed * 0.6) * 12;
        const scale = 0.44 + (Math.sin(seed * 1.4) + 1) * 0.16;
        this.drawDistantTree(ctx, x, y, scale);
      }
    }

    const mask = ctx.createLinearGradient(0, 376, 0, 430);
    mask.addColorStop(0, "rgb(151 209 87 / 0)");
    mask.addColorStop(0.5, "rgb(151 209 87 / 0.82)");
    mask.addColorStop(1, "#9bd85a");
    ctx.fillStyle = mask;
    ctx.beginPath();
    ctx.moveTo(0, 392);
    ctx.bezierCurveTo(210, 370, 412, 414, 646, 386);
    ctx.bezierCurveTo(880, 358, 1068, 412, 1280, 380);
    ctx.lineTo(1280, 442);
    ctx.lineTo(0, 442);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawDistantTree(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#80613a";
    ctx.fillRect(-4, -46, 8, 48);
    ctx.fillStyle = "#6aa748";
    ctx.beginPath();
    ctx.moveTo(0, -116);
    ctx.lineTo(-34, -22);
    ctx.lineTo(34, -22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#82bd55";
    ctx.beginPath();
    ctx.arc(-20, -62, 28, 0, Math.PI * 2);
    ctx.arc(14, -72, 34, 0, Math.PI * 2);
    ctx.arc(36, -44, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawWorld(ctx, game) {
    const cameraX = game.camera.x;
    ctx.save();
    ctx.translate(-cameraX, 0);

    this.drawCatcher(ctx, CONFIG.CATCHER_X, CONFIG.GROUND_Y, game.pitch);
    this.drawBatter(ctx, 292, CONFIG.GROUND_Y, game.pitch, game.state);
    this.drawPitcher(ctx, CONFIG.PITCHER_X, CONFIG.GROUND_Y, game.pitch);

    game.effects.forEach((effect) => {
      if (effect.type === "flash") {
        this.drawImpactFlash(ctx, effect);
      }
      if (effect.type === "dust") {
        this.drawDust(ctx, effect);
      }
    });

    this.drawBall(ctx, game.ball);

    game.texts.forEach((text) => this.drawFloatingText(ctx, text));
    ctx.restore();
  }

  drawHud(ctx, game) {
    ctx.save();
    ctx.fillStyle = "rgb(255 250 238 / 0.88)";
    ctx.strokeStyle = "rgb(255 255 255 / 0.85)";
    ctx.lineWidth = 3;
    this.roundRect(ctx, 24, 22, 456, 92, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#30404a";
    ctx.font = "700 24px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Pitch " + game.score.displayPitch(game.state) + " / " + CONFIG.MAX_PITCHES, 48, 58);
    ctx.fillText("Total " + game.score.totalScore, 48, 92);

    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = this.resultColor(game.score.latestResult);
    ctx.fillText(game.score.latestResult, 248, 58);
    ctx.fillStyle = "#52636d";
    ctx.fillText("Last +" + game.score.latestScore, 248, 92);

    if (game.state === GameState.READY) {
      this.drawCenterBanner(ctx, "Ready");
    }
    if (game.state === GameState.PITCHING && !game.pitch.swingAttempted) {
      ctx.fillStyle = "rgb(48 64 74 / 0.72)";
      ctx.font = "700 25px Trebuchet MS, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Click to swing", CONFIG.WIDTH * 0.5, 92);
      ctx.textAlign = "start";
    }
    ctx.restore();
  }

  drawTitleHint(ctx) {
    ctx.save();
    ctx.fillStyle = "rgb(48 64 74 / 0.24)";
    ctx.font = "700 28px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Bright field. Tiny cats. One very important swing.", CONFIG.WIDTH * 0.5, 646);
    ctx.restore();
  }

  drawCenterBanner(ctx, text) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgb(255 250 238 / 0.82)";
    this.roundRect(ctx, CONFIG.WIDTH * 0.5 - 92, 132, 184, 54, 8);
    ctx.fill();
    ctx.fillStyle = "#30404a";
    ctx.font = "800 30px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(text, CONFIG.WIDTH * 0.5, 168);
    ctx.restore();
  }

  drawPitcher(ctx, x, groundY, pitch) {
    if (this.assets.pitcherReady) {
      this.drawPitcherSprite(ctx, x, groundY, pitch);
      return;
    }

    const pose = this.getPitcherPose(pitch.getPitcherProgress(), pitch.pitcherState);
    this.drawCat(ctx, x, groundY, {
      scale: 0.95,
      facing: -1,
      jersey: "#9fd6ff",
      accent: "#3f95ce",
      cap: "#2f8fc7",
      label: "P",
      pose,
    });
    if (pitch.releasePulse > 0) {
      ctx.save();
      ctx.globalAlpha = pitch.releasePulse / 0.16;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x - 48, groundY - 176, 30, 0.25, Math.PI * 1.4);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPitcherSprite(ctx, x, groundY, pitch) {
    const frame = this.getPitcherSpriteFrame(pitch);
    if (!frame || !frame.canvas || !frame.bounds) {
      return;
    }

    const bounds = frame.bounds;
    const targetHeight = CONFIG.PITCHER_SPRITE_HEIGHT;
    const scale = targetHeight / bounds.height;
    const targetWidth = bounds.width * scale;
    const footY = groundY + 10;
    const centerBias = this.getPitcherSpriteCenterBias(pitch);
    const drawX = x - targetWidth * 0.5 + centerBias;
    const drawY = footY - targetHeight;

    ctx.save();
    ctx.fillStyle = "rgb(67 47 38 / 0.18)";
    ctx.beginPath();
    ctx.ellipse(x - 8, groundY + 1, 82, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(
      frame.canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      drawX,
      drawY,
      targetWidth,
      targetHeight,
    );
    ctx.restore();

    if (pitch.releasePulse > 0) {
      ctx.save();
      ctx.globalAlpha = pitch.releasePulse / 0.16;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x - 72, groundY - 185, 34, 0.25, Math.PI * 1.45);
      ctx.stroke();
      ctx.restore();
    }
  }

  getPitcherSpriteFrame(pitch) {
    const frames = this.assets.pitcherFrames;
    const progress = pitch.getPitcherProgress();
    let index = 0;

    if (pitch.pitcherState === "windup" || pitch.pitcherState === "throw") {
      if (progress < 0.16) {
        index = 0;
      } else if (progress < 0.32) {
        index = 1;
      } else if (progress < 0.47) {
        index = 2;
      } else if (progress < 0.56) {
        index = 3;
      } else {
        index = 4;
      }
    }

    return frames[index];
  }

  getPitcherSpriteCenterBias(pitch) {
    const progress = pitch.getPitcherProgress();
    if (pitch.pitcherState === "idle") {
      return -10;
    }
    if (progress < 0.34) {
      return -8;
    }
    if (progress < 0.56) {
      return -20;
    }
    return -34;
  }

  drawBatter(ctx, x, groundY, pitch, state) {
    if (this.assets.batterReady) {
      this.drawBatterSprite(ctx, x, groundY, pitch, state);
      return;
    }

    const swingProgress = pitch.getSwingProgress();
    const pose = this.getBatterPose(swingProgress, state);
    this.drawCat(ctx, x, groundY, {
      scale: 1.06,
      facing: 1,
      jersey: "#ffd2dc",
      accent: "#ff7188",
      cap: "#ff7991",
      label: "B",
      pose,
    });
    this.drawBat(ctx, x, groundY, swingProgress, state);
  }

  drawBatterSprite(ctx, x, groundY, pitch, state) {
    const frameInfo = this.getBatterSpriteFrame(pitch, state);
    const frame = this.assets.batterFrames[frameInfo.index];
    this.drawCharacterSprite(ctx, frame, x, groundY, CONFIG.BATTER_SPRITE_HEIGHT, frameInfo.bias, {
      shadowWidth: 95,
      shadowX: 4,
    });
  }

  getBatterSpriteFrame(pitch, state) {
    const progress = pitch.getSwingProgress();
    if (progress <= 0 || (state !== GameState.PITCHING && progress <= 0)) {
      return { index: 0, bias: 4 };
    }
    if (progress < 0.26) {
      return { index: 1, bias: 10 };
    }
    if (progress < 0.62) {
      return { index: 2, bias: 54 };
    }
    return { index: 3, bias: -22 };
  }

  drawCatcher(ctx, x, groundY, pitch) {
    if (this.assets.catcherReady) {
      this.drawCatcherSprite(ctx, x, groundY, pitch);
      return;
    }

    const pose = this.getCatcherPose(pitch.catcherState, pitch.getCatcherProgress());
    this.drawCat(ctx, x, groundY + 10, {
      scale: 0.84,
      facing: 1,
      jersey: "#c8e8a4",
      accent: "#69a849",
      cap: "#5f9f42",
      crouch: 1,
      label: "C",
      pose,
    });
    ctx.save();
    ctx.translate(x + 51 + pose.gloveX, groundY - 108 + pose.gloveY);
    ctx.rotate(-0.35 + pose.gloveTilt);
    ctx.fillStyle = "#5a7f63";
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#395c43";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  drawCatcherSprite(ctx, x, groundY, pitch) {
    const frameInfo = this.getCatcherSpriteFrame(pitch);
    const frame = this.assets.catcherFrames[frameInfo.index];
    this.drawCharacterSprite(ctx, frame, x, groundY + 8, CONFIG.CATCHER_SPRITE_HEIGHT, frameInfo.bias, {
      shadowWidth: 92,
      shadowX: 8,
    });
  }

  getCatcherSpriteFrame(pitch) {
    if (pitch.catcherState === "receive") {
      const progress = pitch.getCatcherProgress();
      if (progress < 0.48) {
        return { index: 2, bias: 34 };
      }
      return { index: 3, bias: 24 };
    }
    if (pitch.pitchStarted) {
      return { index: 1, bias: 22 };
    }
    return { index: 0, bias: 10 };
  }

  drawCharacterSprite(ctx, frame, x, groundY, targetHeight, centerBias, options = {}) {
    if (!frame || !frame.canvas || !frame.bounds) {
      return;
    }

    const bounds = frame.bounds;
    const scale = targetHeight / bounds.height;
    const targetWidth = bounds.width * scale;
    const drawX = x - targetWidth * 0.5 + centerBias;
    const drawY = groundY - targetHeight;

    ctx.save();
    ctx.fillStyle = "rgb(67 47 38 / 0.18)";
    ctx.beginPath();
    ctx.ellipse(x + (options.shadowX || 0), groundY - 2, options.shadowWidth || 78, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(
      frame.canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      drawX,
      drawY,
      targetWidth,
      targetHeight,
    );
    ctx.restore();
  }

  getPitcherPose(progress, state) {
    if (state === "idle") {
      return {
        bodyLean: -0.04,
        headTilt: 0.02,
        headX: 0,
        headY: 0,
        backArm: -0.28,
        frontArm: -0.52,
        backLegX: -28,
        backLegY: 0,
        frontLegX: 28,
        frontLegY: 0,
        bodyY: 0,
        bodyScaleX: 1,
        bodyScaleY: 1,
      };
    }

    const p = progress;
    const gather = easeInOut(clamp(p / 0.16, 0, 1));
    const lift = Math.sin(clamp((p - 0.08) / 0.32, 0, 1) * Math.PI);
    const stride = easeInOut(clamp((p - 0.32) / 0.25, 0, 1));
    const release = easeInOut(clamp((p - 0.52) / 0.11, 0, 1));
    const follow = easeInOut(clamp((p - 0.64) / 0.26, 0, 1));
    const settle = easeInOut(clamp((p - 0.82) / 0.18, 0, 1));
    return {
      bodyLean: -0.08 - gather * 0.12 + stride * 0.24 + release * 0.28 - follow * 0.26 + settle * 0.08,
      headTilt: -0.04 - lift * 0.1 + release * 0.18 - follow * 0.08,
      headX: -6 * stride - 6 * follow + 5 * settle,
      headY: -10 * lift + 5 * follow,
      backArm: lerp(-0.45, -1.65, clamp((p - 0.15) / 0.3, 0, 1)) + release * 2.55 - follow * 0.46,
      frontArm: lerp(-0.52, 0.45, lift) - release * 1.05 + follow * 0.28,
      backLegX: -30 + stride * 54 - follow * 8,
      backLegY: -lift * 38 + follow * 14,
      frontLegX: 28 - stride * 72 + settle * 18,
      frontLegY: stride * 7,
      bodyY: -lift * 9 + follow * 8 - settle * 4,
      bodyScaleX: 1 + lift * 0.03 - follow * 0.02,
      bodyScaleY: 1 - lift * 0.04 + follow * 0.05,
    };
  }

  getBatterPose(progress, state) {
    const active = state === GameState.PITCHING || progress > 0;
    if (!active || progress <= 0) {
      return {
        bodyLean: -0.1,
        headTilt: -0.05,
        headX: 0,
        headY: 0,
        backArm: -0.82,
        frontArm: -0.42,
        backLegX: -30,
        backLegY: 0,
        frontLegX: 32,
        frontLegY: 0,
        bodyY: 0,
        bodyScaleX: 1,
        bodyScaleY: 1,
      };
    }

    const load = easeInOut(clamp(progress / 0.25, 0, 1));
    const coil = Math.sin(clamp(progress / 0.36, 0, 1) * Math.PI);
    const stride = easeInOut(clamp((progress - 0.14) / 0.25, 0, 1));
    const contact = easeInOut(clamp((progress - 0.34) / 0.18, 0, 1));
    const follow = easeInOut(clamp((progress - 0.5) / 0.34, 0, 1));
    const settle = easeInOut(clamp((progress - 0.78) / 0.22, 0, 1));
    return {
      bodyLean: -0.18 - load * 0.16 + contact * 0.62 - follow * 0.2 + settle * 0.08,
      headTilt: -0.08 - coil * 0.12 + contact * 0.28 - follow * 0.12,
      headX: -4 * load + 15 * contact - 5 * settle,
      headY: -7 * coil + 4 * follow,
      backArm: -0.95 - load * 0.42 + contact * 1.92 + follow * 0.34 - settle * 0.32,
      frontArm: -0.58 - load * 0.22 + contact * 1.28 + follow * 0.18 - settle * 0.22,
      backLegX: -34 + stride * 7 + follow * 6,
      backLegY: coil * 3,
      frontLegX: 34 + stride * 34 - settle * 8,
      frontLegY: 0,
      bodyY: -coil * 5 + follow * 3,
      bodyScaleX: 1 + coil * 0.04 - follow * 0.02,
      bodyScaleY: 1 - coil * 0.04 + follow * 0.04,
    };
  }

  getCatcherPose(state, progress) {
    const recoil = state === "receive" ? Math.sin(progress * Math.PI) : 0;
    const settle = state === "receive" ? easeInOut(clamp((progress - 0.42) / 0.45, 0, 1)) : 0;
    return {
      bodyLean: -0.1 - recoil * 0.18 + settle * 0.08,
      headTilt: -0.04 - recoil * 0.1 + settle * 0.05,
      headX: -recoil * 8 + settle * 4,
      headY: recoil * 3,
      backArm: 0.1,
      frontArm: -0.62 - recoil * 0.34 + settle * 0.12,
      backLegX: -34 - recoil * 4,
      backLegY: 8,
      frontLegX: 32 + recoil * 6,
      frontLegY: 8,
      bodyY: 12 + recoil * 5,
      bodyScaleX: 1 + recoil * 0.04,
      bodyScaleY: 1 - recoil * 0.05,
      gloveX: recoil * 20 - settle * 8,
      gloveY: recoil * 9,
      gloveTilt: recoil * 0.34 - settle * 0.16,
    };
  }

  drawCat(ctx, x, groundY, options) {
    const scale = options.scale || 1;
    const facing = options.facing || 1;
    const crouch = options.crouch || 0;
    const pose = options.pose || {};
    const bodyY = groundY - 82 * scale + crouch * 18 + (pose.bodyY || 0) * scale;
    const headY = bodyY - 76 * scale + (pose.headY || 0) * scale;
    const headX = (pose.headX || 0) * scale;

    ctx.save();
    ctx.translate(x, 0);
    ctx.scale(facing, 1);

    ctx.fillStyle = "rgb(67 47 38 / 0.16)";
    ctx.beginPath();
    ctx.ellipse(0, groundY - 4, 74 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawLimb(ctx, -22 * scale, bodyY + 44 * scale, (pose.backLegX || -28) * scale, groundY - 13 + (pose.backLegY || 0) * scale, "#f8f2e6", scale);
    this.drawLimb(ctx, 24 * scale, bodyY + 44 * scale, (pose.frontLegX || 28) * scale, groundY - 13 + (pose.frontLegY || 0) * scale, "#f8f2e6", scale);

    ctx.save();
    ctx.translate(0, bodyY);
    ctx.rotate(pose.bodyLean || 0);
    ctx.scale(pose.bodyScaleX || 1, pose.bodyScaleY || 1);
    ctx.fillStyle = options.jersey;
    ctx.beginPath();
    ctx.ellipse(0, 0, 50 * scale, (61 - crouch * 16) * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(73 43 42 / 0.36)";
    ctx.lineWidth = 4 * scale;
    ctx.stroke();
    ctx.restore();

    this.drawArm(ctx, -39 * scale, bodyY - 16 * scale, pose.backArm ?? options.armBack ?? 0, scale, "#f8f2e6");
    this.drawArm(ctx, 39 * scale, bodyY - 16 * scale, pose.frontArm ?? options.armFront ?? 0, scale, "#f8f2e6");

    ctx.fillStyle = "#d7d0bd";
    ctx.beginPath();
    ctx.moveTo(headX - 48 * scale, headY - 23 * scale);
    ctx.lineTo(headX - 86 * scale, headY - 78 * scale);
    ctx.lineTo(headX - 18 * scale, headY - 56 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff9788";
    ctx.beginPath();
    ctx.moveTo(headX - 49 * scale, headY - 39 * scale);
    ctx.lineTo(headX - 68 * scale, headY - 66 * scale);
    ctx.lineTo(headX - 29 * scale, headY - 53 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#d7d0bd";
    ctx.beginPath();
    ctx.moveTo(headX + 48 * scale, headY - 23 * scale);
    ctx.lineTo(headX + 86 * scale, headY - 78 * scale);
    ctx.lineTo(headX + 18 * scale, headY - 56 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff9788";
    ctx.beginPath();
    ctx.moveTo(headX + 49 * scale, headY - 39 * scale);
    ctx.lineTo(headX + 68 * scale, headY - 66 * scale);
    ctx.lineTo(headX + 29 * scale, headY - 53 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(pose.headTilt || 0);
    ctx.strokeStyle = "#3a0f12";
    ctx.lineWidth = 5 * scale;
    ctx.lineJoin = "round";
    ctx.fillStyle = "#ded6c3";
    ctx.beginPath();
    ctx.ellipse(0, 0, 80 * scale, 64 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fffaf0";
    ctx.beginPath();
    ctx.ellipse(0, 27 * scale, 46 * scale, 31 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#9b9486";
    [-22, 0, 22].forEach((stripe) => {
      ctx.beginPath();
      ctx.moveTo(stripe * scale, -58 * scale);
      ctx.quadraticCurveTo((stripe + 5) * scale, -33 * scale, stripe * scale, -18 * scale);
      ctx.lineTo((stripe + 13) * scale, -51 * scale);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = "#351017";
    ctx.beginPath();
    ctx.ellipse(-28 * scale, -7 * scale, 6 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(28 * scale, -7 * scale, 6 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgb(255 142 133 / 0.55)";
    ctx.beginPath();
    ctx.ellipse(-46 * scale, 18 * scale, 15 * scale, 8 * scale, -0.2, 0, Math.PI * 2);
    ctx.ellipse(46 * scale, 18 * scale, 15 * scale, 8 * scale, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff8f86";
    ctx.beginPath();
    ctx.ellipse(0, 14 * scale, 10 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#351017";
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 19 * scale);
    ctx.quadraticCurveTo(-9 * scale, 31 * scale, -19 * scale, 22 * scale);
    ctx.moveTo(0, 19 * scale);
    ctx.quadraticCurveTo(9 * scale, 31 * scale, 19 * scale, 22 * scale);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(0, bodyY);
    ctx.rotate(pose.bodyLean || 0);

    ctx.strokeStyle = options.accent;
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    ctx.moveTo(-31 * scale, -4 * scale);
    ctx.lineTo(31 * scale, -4 * scale);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 " + Math.round(24 * scale) + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.label || "", 0, 18 * scale);
    ctx.restore();

    if (options.cap) {
      ctx.save();
      ctx.translate(headX, headY);
      ctx.rotate(pose.headTilt || 0);
      ctx.fillStyle = options.cap;
      ctx.beginPath();
      ctx.ellipse(0, -47 * scale, 46 * scale, 12 * scale, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(31 * scale, -42 * scale, 28 * scale, 8 * scale, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  drawLimb(ctx, startX, startY, endX, endY, color, scale) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 18 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  drawArm(ctx, x, y, angle, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 18 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(34 * scale, 24 * scale);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(36 * scale, 25 * scale, 13 * scale, 11 * scale, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBat(ctx, x, groundY, progress, state) {
    const idleAngle = -1.22;
    const contact = easeInOut(clamp((progress - 0.24) / 0.3, 0, 1));
    const follow = easeInOut(clamp((progress - 0.55) / 0.35, 0, 1));
    const swingAngle = lerp(-1.22, 0.38, contact) + follow * 0.62;
    const angle = state === GameState.PITCHING || progress > 0 ? swingAngle : idleAngle;
    const pivotX = x + 48 + contact * 14;
    const pivotY = groundY - 158 - Math.sin(progress * Math.PI) * 8;

    if (progress > 0.26 && progress < 0.78) {
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate(angle - 0.22);
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#f7d7a2";
      ctx.lineWidth = 18;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(100, 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    ctx.strokeStyle = "#8a5730";
    ctx.lineWidth = 13;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(96, 0);
    ctx.stroke();
    ctx.strokeStyle = "#c99552";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(92, -2);
    ctx.stroke();
    ctx.restore();
  }

  drawBall(ctx, ball) {
    if (!ball.visible) {
      return;
    }
    ctx.save();

    if (ball.mode === BallMode.PITCH || ball.mode === BallMode.HIT) {
      const speed = Math.hypot(ball.vx, ball.vy);
      const trail = clamp(speed / 900, 0.2, 1);
      ctx.save();
      ctx.globalAlpha = ball.mode === BallMode.PITCH ? 0.42 : 0.22;
      ctx.strokeStyle = ball.mode === BallMode.PITCH ? "#ffffff" : "#ffe5a8";
      ctx.lineWidth = ball.mode === BallMode.PITCH ? 5 : 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ball.x - ball.vx * 0.034 * trail, ball.y - ball.vy * 0.034 * trail);
      ctx.lineTo(ball.x - ball.vx * 0.01 * trail, ball.y - ball.vy * 0.01 * trail);
      ctx.stroke();
      ctx.restore();
    }

    if (this.assets.ballReady) {
      const sprite = this.assets.ballSprite;
      const bounds = sprite.bounds;
      const size = CONFIG.BALL_SPRITE_SIZE;
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.spinAngle);
      ctx.drawImage(
        sprite.canvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        -size * 0.5,
        -size * 0.5,
        size,
        size,
      );
      ctx.restore();
      return;
    }

    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.spinAngle);
    ctx.fillStyle = "#fff8e8";
    ctx.strokeStyle = "#cb3f3a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#d84d48";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-4, 0, 4, -1.2, 1.2);
    ctx.arc(4, 0, 4, Math.PI - 1.2, Math.PI + 1.2);
    ctx.stroke();

    ctx.strokeStyle = "rgb(216 77 72 / 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -5);
    ctx.lineTo(-2, -3);
    ctx.moveTo(-7, 0);
    ctx.lineTo(-3, 2);
    ctx.moveTo(2, -3);
    ctx.lineTo(6, -5);
    ctx.moveTo(3, 2);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawImpactFlash(ctx, effect) {
    const progress = 1 - effect.life / effect.maxLife;
    ctx.save();
    ctx.globalAlpha = clamp(effect.life / effect.maxLife, 0, 1);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 5;
    ctx.translate(effect.x, effect.y);
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      const inner = 14 + progress * 10;
      const outer = 38 + progress * 22;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDust(ctx, effect) {
    const alpha = clamp(effect.life / effect.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#e7d39a";
    ctx.beginPath();
    ctx.ellipse(effect.x - 14, effect.y - 5, 18, 7, 0, 0, Math.PI * 2);
    ctx.ellipse(effect.x + 12, effect.y - 8, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFloatingText(ctx, text) {
    const alpha = clamp(text.life / text.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "800 " + text.size + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgb(255 255 255 / 0.9)";
    ctx.fillStyle = text.color;
    ctx.strokeText(text.text, text.x, text.y);
    ctx.fillText(text.text, text.x, text.y);
    ctx.restore();
  }

  drawCloud(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgb(255 255 255 / 0.72)";
    ctx.beginPath();
    ctx.ellipse(-42, 5, 42, 20, 0, 0, Math.PI * 2);
    ctx.ellipse(0, -8, 48, 27, 0, 0, Math.PI * 2);
    ctx.ellipse(45, 8, 40, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSun(ctx, x, y) {
    ctx.fillStyle = "#fff7c5";
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBush(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#78bd47";
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(i * 22, Math.sin(i) * 8, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFlower(ctx, x, y, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(angle) * 7, Math.sin(angle) * 7, 5, 3, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f6d64a";
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawDistanceMarker(ctx, x, y, value) {
    if (value <= 0) {
      return;
    }
    ctx.save();
    ctx.fillStyle = "rgb(255 255 255 / 0.72)";
    this.roundRect(ctx, x - 28, y - 19, 56, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#6a8757";
    ctx.font = "700 13px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(value + "m", x, y - 2);
    ctx.restore();
  }

  resultColor(result) {
    if (result.includes("Perfect")) return "#ff6a4b";
    if (result.includes("Good")) return "#ee8d28";
    if (result.includes("Weak")) return "#3d86cc";
    if (result.includes("Miss")) return "#7d8790";
    return "#52636d";
  }

  roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.overlay = document.getElementById("overlay");
    this.overlayTitle = document.getElementById("overlayTitle");
    this.overlayText = document.getElementById("overlayText");
    this.primaryButton = document.getElementById("primaryButton");
    this.muteButton = document.getElementById("muteButton");

    this.assets = new AssetLoader();
    this.audio = new AudioManager(this.muteButton);
    this.ball = new Ball();
    this.camera = new Camera();
    this.score = new ScoreSystem();
    this.pitch = new PitchController(this.ball);
    this.renderer = new Renderer(this.canvas, this.assets);
    this.input = new InputController(this, this.canvas, this.primaryButton, this.muteButton);

    this.state = GameState.TITLE;
    this.readyTimer = 0;
    this.resultTimer = 0;
    this.effects = [];
    this.texts = [];
    this.lastTime = performance.now();

    this.updateOverlay();
    requestAnimationFrame((time) => this.loop(time));
  }

  loop(time) {
    const dt = clamp((time - this.lastTime) / 1000, 0, 1 / 30);
    this.lastTime = time;
    this.update(dt);
    this.renderer.render(this);
    requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  handlePrimaryAction() {
    this.audio.unlock();
    if (this.state === GameState.TITLE || this.state === GameState.ROUND_OVER) {
      this.startRound();
      return;
    }

    if (this.state === GameState.PITCHING && !this.pitch.swingAttempted) {
      this.trySwing();
    }
  }

  startRound() {
    this.audio.play("start");
    this.score.reset();
    this.camera.reset();
    this.effects = [];
    this.texts = [];
    this.ball.resetHeld();
    this.pitch.reset();
    this.enterReady();
  }

  enterReady() {
    this.state = GameState.READY;
    this.readyTimer = CONFIG.READY_SECONDS;
    this.resultTimer = 0;
    this.camera.reset();
    this.ball.resetHeld();
    this.pitch.reset();
    this.updateOverlay();
  }

  startPitch() {
    this.state = GameState.PITCHING;
    this.score.beginPitch();
    this.pitch.startPitch();
    this.updateOverlay();
  }

  trySwing() {
    this.pitch.swing();
    this.audio.play("swing");

    if (this.ball.mode !== BallMode.PITCH) {
      this.pitch.markMiss();
      this.score.latestResult = "Whiff";
      this.spawnText("Too Early", CONFIG.CONTACT_X, CONFIG.CONTACT_Y - 72, "#7d8790", 34);
      this.audio.play("miss");
      return;
    }

    const evaluation = HitEvaluator.evaluate(this.ball);
    if (!evaluation.profile) {
      this.pitch.markMiss();
      this.score.latestResult = "Whiff";
      this.spawnText(evaluation.timingError > CONFIG.WEAK_WINDOW ? "Whiff" : "Just Missed", CONFIG.CONTACT_X, CONFIG.CONTACT_Y - 72, "#7d8790", 34);
      this.audio.play("miss");
      return;
    }

    this.ball.launch(evaluation.profile);
    this.state = GameState.BALL_IN_FLIGHT;
    this.score.latestResult = evaluation.result;
    this.score.latestScore = 0;
    this.effects.push({
      type: "flash",
      x: CONFIG.CONTACT_X + 36,
      y: CONFIG.CONTACT_Y,
      life: 0.24,
      maxLife: 0.24,
      color: evaluation.profile.color,
    });
    this.spawnText(evaluation.result, CONFIG.CONTACT_X + 75, CONFIG.CONTACT_Y - 85, evaluation.profile.color, 38);
    this.audio.play(evaluation.result.includes("Perfect") ? "perfect" : evaluation.result.includes("Good") ? "good" : "weak");
    this.updateOverlay();
  }

  resolvePitch(result, score, distance, wasHit) {
    this.state = GameState.SWING_RESOLVED;
    this.resultTimer = wasHit ? CONFIG.RESULT_SECONDS + 0.2 : CONFIG.RESULT_SECONDS;
    this.ball.mode = wasHit ? BallMode.STOPPED : this.ball.mode;
    this.score.record(result, score, distance);
    this.updateOverlay();
  }

  update(dt) {
    this.updateEffects(dt);
    if (this.state !== GameState.PITCHING) {
      this.pitch.updatePoseTimers(dt);
    }

    if (this.state === GameState.READY) {
      this.readyTimer -= dt;
      if (this.readyTimer <= 0) {
        this.startPitch();
      }
      return;
    }

    if (this.state === GameState.PITCHING) {
      const pitchEvents = this.pitch.update(dt);
      if (pitchEvents.includes("pitchRelease")) {
        this.audio.play("pitch");
      }
      if (this.ball.mode === BallMode.PITCH && this.ball.x <= CONFIG.CATCHER_RECEIVE_X) {
        this.pitch.receive();
        this.ball.visible = false;
        this.ball.mode = BallMode.STOPPED;
        this.spawnText(this.pitch.pendingMiss ? "Miss" : "No Swing", CONFIG.CONTACT_X, CONFIG.CONTACT_Y - 72, "#7d8790", 36);
        this.audio.play("catch");
        this.audio.play("miss");
        this.resolvePitch("Miss", 0, 0, false);
      }
      return;
    }

    if (this.state === GameState.BALL_IN_FLIGHT) {
      const effects = this.ball.updateHit(dt);
      this.effects.push(...effects.map((effect) => ({ ...effect, maxLife: effect.life })));
      effects.forEach((effect) => {
        if (effect.type === "dust") {
          this.audio.play("bounce");
        }
      });
      this.camera.update(dt, this.ball);
      if (this.ball.mode === BallMode.STOPPED) {
        const result = this.score.latestResult;
        const profile = result.includes("Perfect")
          ? HIT_PROFILES.Perfect
          : result.includes("Good")
            ? HIT_PROFILES.Good
            : HIT_PROFILES.Weak;
        const score = Math.max(1, Math.round(this.ball.distance * CONFIG.SCORE_MULTIPLIER * profile.scoreBonus));
        this.spawnText("+" + score, this.ball.x, this.ball.y - 44, "#30404a", 34);
        this.resolvePitch(result, score, Math.round(this.ball.distance), true);
      }
      return;
    }

    if (this.state === GameState.SWING_RESOLVED) {
      this.camera.update(dt, this.ball);
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.score.isRoundComplete()) {
          this.state = GameState.ROUND_OVER;
          this.audio.play("roundOver");
          this.updateOverlay();
        } else {
          this.enterReady();
        }
      }
    }
  }

  updateEffects(dt) {
    this.effects.forEach((effect) => {
      effect.life -= dt;
    });
    this.effects = this.effects.filter((effect) => effect.life > 0);

    this.texts.forEach((text) => text.update(dt));
    this.texts = this.texts.filter((text) => text.alive);
  }

  spawnText(text, x, y, color, size) {
    this.texts.push(new FloatingText(text, x, y, color, size));
  }

  updateOverlay() {
    if (this.state === GameState.TITLE) {
      this.overlay.classList.remove("hidden");
      this.overlayTitle.textContent = "Chibi Cat Baseball";
      this.overlayText.textContent = "Click at the sweet spot and chase a big 10-pitch score.";
      this.primaryButton.textContent = "Start Game";
      return;
    }

    if (this.state === GameState.ROUND_OVER) {
      this.overlay.classList.remove("hidden");
      this.overlayTitle.textContent = "Round Complete";
      this.overlayText.textContent = "Final score: " + this.score.totalScore + " points";
      this.primaryButton.textContent = "Replay";
      return;
    }

    this.overlay.classList.add("hidden");
  }
}

window.addEventListener("load", () => {
  new Game();
});
