import type { Art } from "./assets";
import { ARM_X, HEAD_DODGE_DOWN, HEAD_DODGE_X, type Game } from "./game";
import type { Point } from "./geometry";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandTracker } from "./hand";
import { PLAYER_MAX_HP, SW_LINE_X } from "./stats";
import type { SetupView } from "./tutorial";

export const STAGE_W = 728;
export const STAGE_H = 480;

const PROMPTS: Record<string, { text: string; button: string }> = {
  attack: { text: "손을 오른쪽으로! (공격 준비)", button: "btn_attack" },
  slap: { text: "지금! 얼굴을 향해 왼쪽으로 휘둘러!", button: "btn_attack" },
  evade: { text: "온다! 손을 왼쪽으로", button: "btn_evade" },
  dodge: { text: "오른쪽으로 휙! 피해!", button: "btn_evade" },
  evadeBody: { text: "온다! 몸을 가운데로", button: "btn_evade" },
  dodgeBody: { text: "지금! 몸을 옆으로 빼거나 숙여!", button: "btn_evade" },
  counter: { text: "반격 찬스! 오른쪽에서 휘둘러!", button: "btn_counter" },
};

/**
 * Draw a polyline as a smooth curve: each piece runs midpoint-to-midpoint with the sample as the control point,
 * so ~30 Hz tracking samples read as one continuous swipe instead of a jagged chain.
 */
function strokeSmooth<T extends Point>(ctx: CanvasRenderingContext2D, pts: T[], style: (p: T) => void) {
  if (pts.length < 2) return;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  for (let i = 1; i < pts.length; i++) {
    const start = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
    const end = i === pts.length - 1 ? pts[i] : mid(pts[i - 1], pts[i]);
    style(pts[i]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, end.x, end.y);
    ctx.stroke();
  }
}

export class Renderer {
  private trail: (Point & { t: number })[] = [];
  private camTrail: (Point & { t: number })[] = [];
  private peakSpeed = 0;

  constructor(private ctx: CanvasRenderingContext2D, private art: Art) {}

  draw(game: Game, hand: Point | null, cam: HandTracker | null, debug: boolean) {
    const { ctx, art } = this;
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - 0.5) * game.shake * 2, (Math.random() - 0.5) * game.shake * 2);

    ctx.drawImage(game.isBoss ? art.ui.background_boss : art.ui.background, 0, 0);
    this.drawEnemy(game);
    this.drawPlayer(game);
    ctx.restore();

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 0.12})`;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    this.drawTrail(game, hand);
    this.drawHud(game);
    if (debug) this.drawDebug(game);
    if (cam) this.drawCamera(game, cam);
    this.drawBanner(game);
  }

  private drawEnemy(game: Game) {
    const { ctx } = this;
    const e = this.art.enemies[game.enemyIndex];
    const ko = game.enemyPose === 8;
    const pose = e.poses[String(ko ? 7 : game.enemyPose)] ?? e.poses["1"];
    ctx.save();
    if (ko) {
      // KO animation (sprites 216/241/...) isn't ported: tilt and fade the critical-hit pose instead
      ctx.globalAlpha = Math.max(0.15, 1 - game.bannerAge / 60);
      ctx.translate(140, 480);
      ctx.rotate(Math.min(game.bannerAge, 20) * -0.01);
      ctx.translate(-140, -480);
    }
    ctx.drawImage(pose, 0, 0);
    if (game.enemyPose === 3 && e.strikeOverlay) ctx.drawImage(e.strikeOverlay.img, ...e.strikeOverlay.at);
    // enemyFace: bruises only show on poses 1-3
    if (game.bruise > 0 && game.enemyPose <= 3) ctx.drawImage(e.bruise.frames[game.bruise - 1], ...e.bruise.at);
    ctx.restore();
  }

  private drawPlayer(game: Game) {
    const { ctx } = this;
    const p = this.art.player;
    const ko = game.playerPose === 7;
    ctx.save();
    if (ko) ctx.globalAlpha = 0.6;
    ctx.drawImage(p.poses[String(ko ? 6 : game.playerPose)], ...p.at);
    ctx.restore();
  }

  private drawTrail(game: Game, hand: Point | null) {
    const { ctx } = this;
    const now = performance.now();
    const lastT = this.trail[this.trail.length - 1];
    if (hand && game.armed && (!lastT || lastT.x !== hand.x || lastT.y !== hand.y)) this.trail.push({ ...hand, t: now });
    const LIFE = 400;
    this.trail = this.trail.filter((p) => now - p.t < LIFE).slice(-24);
    ctx.save();
    ctx.lineCap = "round";
    strokeSmooth(ctx, this.trail, (p) => {
      const k = 1 - (now - p.t) / LIFE;
      ctx.strokeStyle = `rgba(255,170,200,${0.7 * k})`;
      ctx.lineWidth = 14 * k + 2;
    });
    ctx.restore();
    if (hand) {
      ctx.save();
      ctx.fillStyle = game.armed ? "rgba(255,120,170,0.95)" : "rgba(255,255,255,0.7)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, game.armed ? 11 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHud(game: Game) {
    const { ctx, art } = this;
    // Flowers: one camellia per 1000 enemy HP (left), one rose per 250 Reiko HP (right) — setHp.
    // Lost HP shows the scattered-petal frame; the current flower fades as it drains.
    const flowers = (bloom: HTMLImageElement, lost: HTMLImageElement, hp: number, max: number, per: number, x0: number, dx: number) => {
      const total = Math.ceil(max / per);
      for (let i = 0; i < total; i++) {
        const frac = Math.max(0, Math.min(1, (hp - i * per) / per));
        const img = frac > 0 ? bloom : lost;
        ctx.globalAlpha = frac > 0 ? 0.4 + 0.6 * frac : 0.8;
        ctx.drawImage(img, x0 + dx * i - img.width / 2, 446 - img.height / 2);
      }
      ctx.globalAlpha = 1;
    };
    flowers(art.ui.life_camellia, art.ui.life_camellia_lost, game.enemyHp, game.enemyMaxHp, 1000, 28, 30);
    flowers(art.ui.life_rose, art.ui.life_rose_lost, game.playerHp, PLAYER_MAX_HP, 250, 700, -30);

    // HP bars
    const bar = (x: number, w: number, frac: number, color: string) => {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x, 8, w, 10);
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, 9, (w - 2) * Math.max(0, Math.min(1, frac)), 8);
    };
    bar(10, 230, game.enemyHp / game.enemyMaxHp, "#c2334d");
    bar(STAGE_W - 240, 230, game.playerHp / PLAYER_MAX_HP, "#d96aa0");

    const e = art.enemies[game.enemyIndex];
    ctx.font = "bold 13px Georgia, serif";
    ctx.fillStyle = "#f6ead7";
    ctx.textAlign = "left";
    ctx.fillText(`${e.title}  ${e.name}`, 10, 34);
    ctx.textAlign = "right";
    ctx.fillText("Bride  Reiko Tsubakikoji", STAGE_W - 10, 34);

    // Time bar (whose turn it is)
    const tbX = STAGE_W / 2 - 100;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(tbX, 44, 200, 8);
    ctx.fillStyle = game.turn === "player" ? "#ff8fb3" : "#8fb8ff";
    ctx.fillRect(tbX, 44, game.bar - 10, 8);
    ctx.textAlign = "center";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(game.turn === "player" ? "내 차례" : "상대 차례", STAGE_W / 2, 66);

    // Prompt + original button art
    const pr = game.prompt && PROMPTS[game.prompt];
    if (pr) {
      const btn = art.ui[pr.button];
      ctx.drawImage(btn, STAGE_W / 2 - 30, 76);
      ctx.font = "bold 20px sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(pr.text, STAGE_W / 2, 160);
      ctx.fillStyle = "#fff";
      ctx.fillText(pr.text, STAGE_W / 2, 160);
    }

    // Damage popups
    for (const p of game.popups) {
      ctx.globalAlpha = 1 - p.age / 40;
      ctx.font = "bold 28px Georgia, serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(p.text, p.x, p.y - p.age);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - p.age);
    }
    ctx.globalAlpha = 1;

    // Speed meter for calibration: needs >= enemy's dodge threshold
    ctx.textAlign = "left";
    ctx.font = "12px sans-serif";
    ctx.fillStyle = game.lastSpeed >= game.stats.speedNeeded ? "#9effa0" : "#ffd0d0";
    ctx.fillText(`마지막 스윙 속도 ${Math.round(game.lastSpeed)} / 필요 ${game.stats.speedNeeded}`, 10, 474);
  }

  private drawDebug(game: Game) {
    const { ctx } = this;
    const l = game.hitLines;
    if (!l) return;
    const line = (s: { x1: number; y1: number; x2: number; y2: number }, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    };
    line(l.face, "#ff3b3b");
    line(l.cheek, "#ffd400");
    line(l.approach, "#3bff6e");
    ctx.setLineDash([6, 6]);
    line({ x1: SW_LINE_X, y1: 0, x2: SW_LINE_X, y2: STAGE_H }, "#59a8ff");
    line({ x1: ARM_X, y1: 0, x2: ARM_X, y2: STAGE_H }, "rgba(255,255,255,0.5)");
    line({ x1: game.stats.whiffX, y1: 0, x2: game.stats.whiffX, y2: STAGE_H }, "rgba(255,100,100,0.5)");
    ctx.setLineDash([]);
  }

  /**
   * Small webcam preview at the bottom with the tracked hand skeleton on top,
   * so you can see what the tracker is picking up.
   */
  private drawCamera(game: Game, cam: HandTracker) {
    const { ctx } = this;
    const w = 200;
    const h = Math.round((w * (cam.video.videoHeight || 9)) / (cam.video.videoWidth || 16));
    const x = (STAGE_W - w) / 2;
    const y = STAGE_H - h - 8;

    const lm = this.drawCamImage(cam, x, y, w, h, game.armed);
    if (game.bodyDodge) this.drawHead(game, cam, x, y, w, h);

    // Status + live swing-speed meter (marker = speed this enemy needs)
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = lm ? "#7fffd0" : "#ff8080";
    ctx.fillText(lm ? "● 손 인식됨" : "● 손 없음", x + 5, y + 13);

    this.peakSpeed = Math.max(game.swingSpeed, this.peakSpeed * 0.9);
    const need = game.stats.speedNeeded;
    const full = need * 2.5;
    const by = y + h - 7;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x + 4, by, w - 8, 4);
    ctx.fillStyle = this.peakSpeed >= need ? "#9effa0" : "#ffd27f";
    ctx.fillRect(x + 4, by, (w - 8) * Math.min(1, this.peakSpeed / full), 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 4 + (w - 8) * (need / full) - 1, by - 3, 2, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.fillText(`속도 ${Math.round(this.peakSpeed)}`, x + w - 5, y + 13);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = cam.fps >= 24 ? "rgba(255,255,255,0.75)" : "#ffb36b";
    ctx.fillText(`인식 ${Math.round(cam.fps)}fps`, x + w - 5, y + 26);
  }

  /** Tutorial webcam setup: big preview, reach zones, swing calibration readout. */
  drawSetup(view: SetupView, cam: HandTracker | null, hand: Point | null, gain: number, needFace: boolean) {
    const { ctx, art } = this;
    ctx.drawImage(art.ui.background, 0, 0);
    ctx.fillStyle = "rgba(10,6,8,0.72)";
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    if (view.step === "reach") {
      const zone = (x: number, w: number, done: boolean, label: string) => {
        ctx.fillStyle = done ? "rgba(120,255,170,0.22)" : "rgba(255,120,175,0.18)";
        ctx.fillRect(x, 0, w, STAGE_H);
        ctx.fillStyle = done ? "#9effa0" : "#ffb3d0";
        ctx.font = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(done ? "✓" : label, x + w / 2, STAGE_H / 2);
      };
      zone(0, 150, view.reachedLeft, "← 여기까지");
      zone(580, STAGE_W - 580, view.reachedRight, "여기까지 →");
    }

    const w = 360;
    const h = cam ? Math.round((w * (cam.video.videoHeight || 9)) / (cam.video.videoWidth || 16)) : 202;
    const x = (STAGE_W - w) / 2;
    const y = 96;
    const lm = cam ? this.drawCamImage(cam, x, y, w, h, false) : null;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = lm ? "#7fffd0" : "#ff8080";
    ctx.fillText(lm ? "● 손 인식됨" : "● 손이 안 보여요", x + 8, y + 18);
    if (needFace && cam) {
      const f = cam.face;
      ctx.fillStyle = f ? "#8fb8ff" : "#ff8080";
      ctx.fillText(f ? "● 얼굴 인식됨 (몸 회피)" : "● 얼굴이 안 보여요", x + 8, y + 36);
      if (f) {
        const fw = f.w * w;
        ctx.strokeStyle = "#8fb8ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + f.x * w - fw / 2, y + f.y * h - fw * 0.6, fw, fw * 1.2);
      }
    }

    const by = y + h + 18;
    if (view.step === "see") {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(x, by, w, 8);
      ctx.fillStyle = "#7fffd0";
      ctx.fillRect(x, by, w * view.seeProgress, 8);
    }
    if (view.step === "swing") {
      ctx.textAlign = "center";
      ctx.font = "bold 30px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText("← ← ←", STAGE_W / 2, by + 26);
      ctx.font = "13px sans-serif";
      for (let i = 0; i < 3; i++) {
        const v = view.swings[i];
        const cx = STAGE_W / 2 + (i - 1) * 90;
        ctx.fillStyle = v ? "rgba(120,255,170,0.25)" : "rgba(255,255,255,0.08)";
        ctx.fillRect(cx - 38, by + 40, 76, 30);
        ctx.fillStyle = v ? "#9effa0" : "rgba(255,255,255,0.5)";
        ctx.fillText(v ? `${Math.round(v)}` : `스윙 ${i + 1}`, cx, by + 60);
      }
      if (view.swings.length >= 3) {
        ctx.fillStyle = "#ffe3ec";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(`감도 ×${gain.toFixed(1)}`, STAGE_W / 2, by + 92);
      }
    }

    if (hand) {
      ctx.fillStyle = "rgba(255,120,170,0.95)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Body-dodge overlay on the preview: face box, its resting spot, and how far you need to move.
   * Face coords are already mirrored, so they're drawn without the flip.
   */
  private drawHead(game: Game, cam: HandTracker, x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const f = cam.face;
    const b = game.headBase;
    ctx.save();
    if (b && f) {
      // Dodge thresholds around the resting spot, in face widths (preview has the camera's aspect)
      const fw = f.w * w;
      const bx = x + b.x * w;
      const by = y + b.y * h;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(143,184,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx - fw * HEAD_DODGE_X, by - fw, fw * HEAD_DODGE_X * 2, fw * (1 + HEAD_DODGE_DOWN));
      ctx.setLineDash([]);
    }
    if (f) {
      const o = game.headOffset;
      const out = o && (Math.abs(o.dx) > HEAD_DODGE_X || o.dy > HEAD_DODGE_DOWN);
      ctx.strokeStyle = out ? "#9effa0" : "#ffdc5a";
      ctx.lineWidth = 2;
      const fw = f.w * w;
      const fh = fw * 1.2;
      ctx.strokeRect(x + f.x * w - fw / 2, y + f.y * h - fh / 2, fw, fh);
    }
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = f ? "#8fb8ff" : "#ff8080";
    ctx.fillText(f ? "몸 회피 ON" : "얼굴이 안 보여요", x + 5, y + 26);
    ctx.restore();
  }

  /** Mirrored webcam frame with the hand skeleton and palm trail drawn on top. */
  private drawCamImage(cam: HandTracker, x: number, y: number, w: number, h: number, armed: boolean) {
    const { ctx } = this;
    const now = performance.now();
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = true;
    ctx.translate(x + w, y);
    ctx.scale(-1, 1); // mirror, like the stage mapping
    ctx.drawImage(cam.video, 0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, w, h);

    const lm = cam.landmarks;
    if (lm) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = armed ? "#ff7fb0" : "#7fffd0";
      ctx.beginPath();
      for (const c of HandLandmarker.HAND_CONNECTIONS) {
        ctx.moveTo(lm[c.start].x * w, lm[c.start].y * h);
        ctx.lineTo(lm[c.end].x * w, lm[c.end].y * h);
      }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      for (const p of lm) ctx.fillRect(p.x * w - 1.5, p.y * h - 1.5, 3, 3);
      // Palm centre (the point the game uses), with a short motion trail
      const ids = [0, 5, 9, 17];
      const px = (ids.reduce((s, i) => s + lm[i].x, 0) / ids.length) * w;
      const py = (ids.reduce((s, i) => s + lm[i].y, 0) / ids.length) * h;
      const last = this.camTrail[this.camTrail.length - 1];
      if (!last || last.x !== px || last.y !== py) this.camTrail.push({ x: px, y: py, t: now });
    }
    this.camTrail = this.camTrail.filter((p) => now - p.t < 450);
    ctx.lineCap = "round";
    strokeSmooth(ctx, this.camTrail, (p) => {
      ctx.strokeStyle = `rgba(255,220,90,${1 - (now - p.t) / 450})`;
      ctx.lineWidth = 3;
    });
    const tip = this.camTrail[this.camTrail.length - 1];
    if (tip && lm) {
      ctx.fillStyle = "#ffdc5a";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return lm;
  }

  private drawBanner(game: Game) {
    const { ctx, art } = this;
    const img =
      game.banner === "start" ? art.ui.text_start
      : game.banner === "win" ? art.ui.text_win
      : game.banner === "lose" ? art.ui.text_lose
      : null;
    if (img) {
      const s = Math.min(1, 0.6 + game.bannerAge / 20);
      ctx.save();
      ctx.globalAlpha = Math.min(1, game.bannerAge / 8);
      ctx.translate(STAGE_W / 2, STAGE_H / 2);
      ctx.scale(s, s);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
    if (game.banner === "clear") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffe3ec";
      ctx.font = "bold 44px Georgia, serif";
      ctx.fillText("ALL CLEAR", STAGE_W / 2, STAGE_H / 2);
    }
  }
}
