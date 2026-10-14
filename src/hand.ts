// Input -> a "mouse" in stage coordinates (728x480), standing in for _root._xmouse/_ymouse.

import { FaceDetector, FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Point } from "./geometry";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** Fraction of the camera frame (each side) that maps outside the stage, so you don't need to reach the very edge. */
const MARGIN = 0.12;
/** After this long without a sample, the next one starts a fresh stroke. */
const LOST_MS = 250;

interface Sample extends Point {
  t: number;
}

/** Face centre in normalized camera coords, mirrored like the stage (x grows to your right); w = face width / frame width. */
export interface Head {
  x: number;
  y: number;
  w: number;
  /** frame height / width, to measure vertical moves in face widths too */
  aspect: number;
}

export interface Pointer {
  readonly visible: boolean;
  /** Latest position consumed by takeStroke */
  readonly lastPoint: Point | null;
  /** Called every animation frame */
  update(now: number): void;
  /** Movement since the previous game tick; speed in px per 1/30 s (the original's unit). */
  takeStroke(): { from: Point; to: Point; speed: number } | null;
}

/** Shared stroke bookkeeping: the game consumes at most one segment per tick. */
abstract class StrokeSource implements Pointer {
  protected pending: Sample | null = null;
  private last: Sample | null = null;

  abstract update(now: number): void;

  get visible(): boolean {
    return this.last !== null && performance.now() - this.last.t < LOST_MS;
  }

  get lastPoint(): Point | null {
    return this.last;
  }

  takeStroke() {
    const p = this.pending;
    this.pending = null;
    if (!p) return this.last && { from: this.last, to: this.last, speed: 0 };
    const prev = this.last && p.t - this.last.t < LOST_MS ? this.last : p;
    this.last = p;
    const dt = Math.max(p.t - prev.t, 1000 / 60);
    const speed = (Math.hypot(p.x - prev.x, p.y - prev.y) / dt) * (1000 / 30);
    return { from: prev, to: p, speed };
  }
}

export class HandTracker extends StrokeSource {
  video = document.createElement("video");
  landmarks: NormalizedLandmark[] | null = null;
  /** For body dodging (higher difficulties) */
  face: Head | null = null;
  /** Run the face detector at all (only needed for body dodging) */
  trackFace = false;
  /** Hand detections per second, for the preview */
  fps = 0;
  private frameNo = 0;
  private fpsCount = 0;
  private fpsStart = 0;
  private lastVideoTime = -1;
  private landmarker: HandLandmarker | null = null;
  private faceDetector: FaceDetector | null = null;

  constructor(private stageW: number, private stageH: number) {
    super();
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      // The models downscale internally anyway; a smaller frame is much cheaper to upload every frame
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    this.video.srcObject = stream;
    this.video.playsInline = true;
    this.video.muted = true;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    [this.landmarker, this.faceDetector] = await Promise.all([
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      }),
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      }),
    ]);

    // Detect as soon as each camera frame arrives (falls back to polling in update())
    if ("requestVideoFrameCallback" in this.video) {
      const onFrame = (now: number) => {
        this.detect(now);
        this.video.requestVideoFrameCallback(onFrame);
      };
      this.video.requestVideoFrameCallback(onFrame);
      this.frameDriven = true;
    }
  }

  private frameDriven = false;

  update(now: number) {
    if (!this.frameDriven) this.detect(now);
  }

  private detect(now: number) {
    if (!this.landmarker || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.frameNo++;
    this.countFps(now);
    if (!this.trackFace) this.face = null;
    else if (this.frameNo % 2 === 0) this.updateFace(now);
    const lm = this.landmarker.detectForVideo(this.video, now).landmarks[0];
    this.landmarks = lm ?? null;
    if (!lm) return;
    // Palm centre: wrist + index/middle/pinky knuckles
    const ids = [0, 5, 9, 17];
    const nx = ids.reduce((s, i) => s + lm[i].x, 0) / ids.length;
    const ny = ids.reduce((s, i) => s + lm[i].y, 0) / ids.length;
    const span = 1 - 2 * MARGIN;
    this.pending = {
      x: ((1 - nx - MARGIN) / span) * this.stageW, // mirrored, like looking in a mirror
      y: ((ny - MARGIN) / span) * this.stageH,
      t: now,
    };
  }

  private countFps(now: number) {
    this.fpsCount++;
    if (now - this.fpsStart >= 1000) {
      this.fps = (this.fpsCount * 1000) / (now - this.fpsStart);
      this.fpsCount = 0;
      this.fpsStart = now;
    }
  }

  private updateFace(now: number) {
    const box = this.faceDetector?.detectForVideo(this.video, now).detections[0]?.boundingBox;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    this.face = box && vw && vh
      ? { x: 1 - (box.originX + box.width / 2) / vw, y: (box.originY + box.height / 2) / vh, w: box.width / vw, aspect: vh / vw }
      : null;
  }
}

/** Mouse fallback (?input=mouse or no camera) — exactly how the original was played. */
export class MousePointer extends StrokeSource {
  constructor(private canvas: HTMLCanvasElement, private stageW: number, private stageH: number) {
    super();
    canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pending = {
        x: ((e.clientX - r.left) / r.width) * this.stageW,
        y: ((e.clientY - r.top) / r.height) * this.stageH,
        t: performance.now(),
      };
    });
  }

  update() {}

  get visible(): boolean {
    return true;
  }
}
