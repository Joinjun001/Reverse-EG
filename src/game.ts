// Battle logic ported from duplex.Game_system (gameMainProg / nagurikiseki / enemy_dmg / reikoDmg / timebar).
// State numbers match the original so the decompiled source can be read side by side.
//
// The only real change: the original waited for clicks on the Attack / Evade / Counter buttons
// (talkMain). With a webcam there is no click, so a pose "arms" the action instead:
//   attack / counter: bring your hand to the right side (behind the slap's start line)
//   evade:            have your hand left of the dodge line, then swipe right across it

import { lineCrossPoint, type Point } from "./geometry";
import type { Head } from "./hand";
import {
  ENEMY_COUNT, PLAYER_MAX_HP, PLAYER_START_HP, SW_LINE_X, enemyStats, type EnemyStats, type Line,
} from "./stats";

/** Body dodge (difficulty 3+): head offset from its resting spot, in face widths */
export const HEAD_CENTER = 0.3;
export const HEAD_DODGE_X = 0.6;
export const HEAD_DODGE_DOWN = 0.45;
export const BODY_DODGE_LEVEL = 3;

/** Lengthen a line about its midpoint */
function stretch(l: Line, k: number): Line {
  const cx = (l.x1 + l.x2) / 2;
  const cy = (l.y1 + l.y2) / 2;
  return { x1: cx + (l.x1 - cx) * k, y1: cy + (l.y1 - cy) * k, x2: cx + (l.x2 - cx) * k, y2: cy + (l.y2 - cy) * k };
}

/** Hand must be right of this x to arm an attack / counter */
export const ARM_X = 420;
const ARM_TICKS = 2;

export interface Stroke {
  from: Point;
  to: Point;
  /** px per 1/30 s, already multiplied by the sensitivity gain */
  speed: number;
}

export type Prompt = "attack" | "slap" | "evade" | "dodge" | "evadeBody" | "dodgeBody" | "counter" | null;
export type Banner = "start" | "win" | "lose" | "clear" | null;
export type Phase = "battle" | "gameover" | "clear";
/** Tutorial practice drills */
export type Lesson = "attack" | "evade" | "counter";
/** What just happened — the tutorial listens to these to count progress and give feedback */
export type GameEvent =
  | "hit" | "crit" | "slow" | "miss" | "whiff" | "late" | "dodge" | "hurt" | "counter" | "counterMissed";

export interface Popup {
  text: string;
  x: number;
  y: number;
  age: number;
  color: string;
}

export interface Sfx {
  play(key: string): void;
  playBgm(key: string): void;
  stopBgm(): void;
}

export class Game {
  phase: Phase = "battle";
  enemyIndex = 0;
  stats!: EnemyStats;
  enemyHp = 0;
  enemyMaxHp = 0;
  playerHp = PLAYER_START_HP;
  /** enemyFc: bruise stage 0..4 */
  bruise = 0;
  enemyPose = 1;
  playerPose = 1;
  prompt: Prompt = null;
  banner: Banner = null;
  bannerAge = 0;
  /** Trail is drawn while an action is armed (MOUSELINEDRAW) */
  armed = false;
  turn: "player" | "enemy" = "player";
  /** Time bar position, 10..210 like time_barMC.myber._x */
  bar = 210;
  lastSpeed = 0;
  shake = 0;
  flash = 0;
  popups: Popup[] = [];
  /** debug flag from the original: keys 1-5 jump to an enemy, player can't die */
  muteki = false;
  /** Tutorial drill: no turn timer, nobody loses HP, the enemy never falls */
  practice: Lesson | null = null;
  onEvent: ((e: GameEvent) => void) | null = null;
  /** Webcam input: enables body dodging and widens the small crit lines (tracking is noisier than a mouse) */
  webcam = false;
  /** Latest face position (set by the caller before each tick) */
  head: Head | null = null;
  /** Resting head position, learned while you're not dodging */
  headBase: { x: number; y: number } | null = null;

  private state = 0;
  private t = 0;
  private evadeStep = 0; // buff[2]: 0 wait arm, 1 armed, 100 done
  private dodged = false; // buff[4]
  private hitResult = 0; // sys[2]: 0 none, 1 hit, 2 critical
  private hitline = { active: false, bound: 0, step: 0, crit: false };
  private timebar: "off" | "player" | "toEnemy" | "enemy" | "toPlayer" = "off";
  private armCount = 0;
  private bak: Point = { x: 0, y: 0 };
  private now: Point = { x: 0, y: 0 };
  private speed = 0;

  constructor(private sfx: Sfx, public level = 1) {}

  newRun(level = this.level, enemy = 0) {
    this.practice = null;
    this.level = level;
    this.playerHp = PLAYER_START_HP;
    this.phase = "battle";
    this.startBattle(enemy);
  }

  /** battle_ini + setHp */
  startBattle(index: number) {
    this.enemyIndex = index;
    this.stats = enemyStats(index, this.level);
    if (this.webcam) {
      // Original approach line is only ~20px tall: fine for a mouse, too thin for ~30fps hand tracking
      this.stats.approach = stretch(this.stats.approach, 2.5);
      this.stats.cheek = stretch(this.stats.cheek, 1.6);
    }
    this.enemyHp = this.enemyMaxHp = this.stats.hp;
    this.bruise = 0;
    this.enemyPose = this.playerPose = 1;
    this.prompt = null;
    this.armed = false;
    this.timebar = "off";
    this.turn = "player";
    this.bar = 210;
    this.hitline.active = false;
    this.state = 1;
    this.t = 0;
    this.setBanner(null);
    this.sfx.playBgm(index < 4 ? "nf" : "bf");
  }

  /** Tutorial drill against the first opponent: she never dodges, and swings slower so you can learn the timing. */
  startPractice(lesson: Lesson) {
    this.practice = lesson;
    this.phase = "battle";
    this.playerHp = PLAYER_START_HP;
    this.startBattle(0);
    this.stats.luck = 0;
    if (lesson !== "attack") {
      this.stats.windup = Math.round(this.stats.windup * 1.6);
      this.stats.counterWindow = Math.round(this.stats.counterWindow * 1.5);
    }
    this.turn = lesson === "attack" ? "player" : "enemy";
    this.state = lesson === "attack" ? 3 : 10;
  }

  private emit(e: GameEvent) {
    this.onEvent?.(e);
  }

  /** Difficulty 3+ with a webcam: dodge by moving your body instead of swiping your hand */
  get bodyDodge(): boolean {
    return this.webcam && this.level >= BODY_DODGE_LEVEL;
  }

  /** Head offset from rest, in face widths (+x = your right, +y = down) */
  get headOffset(): { dx: number; dy: number } | null {
    const h = this.head;
    const b = this.headBase;
    if (!h || !b || h.w <= 0) return null;
    return { dx: (h.x - b.x) / h.w, dy: ((h.y - b.y) * h.aspect) / h.w };
  }

  private updateHeadBase() {
    const h = this.head;
    if (!h) return;
    // Freeze the reference while she's winding up / striking
    if (this.state >= 11 && this.state <= 13) return;
    if (!this.headBase) this.headBase = { x: h.x, y: h.y };
    else {
      this.headBase.x += (h.x - this.headBase.x) * 0.05;
      this.headBase.y += (h.y - this.headBase.y) * 0.05;
    }
  }

  get isBoss() {
    return this.enemyIndex === ENEMY_COUNT - 1;
  }

  /** One 1/30 s step — the Flash movie ran at 30 fps. */
  tick(stroke: Stroke | null, handVisible: boolean) {
    if (stroke) {
      this.bak = stroke.from;
      this.now = stroke.to;
      this.speed = stroke.speed;
    } else {
      this.bak = this.now;
      this.speed = 0;
    }
    this.bannerAge++;
    if (this.shake > 0) this.shake--;
    if (this.flash > 0) this.flash--;
    for (const p of this.popups) p.age++;
    this.popups = this.popups.filter((p) => p.age < 40);

    this.updateHeadBase();
    this.updateTimebar();
    this.updateHitline();
    this.gameMainProg(handVisible);
    this.updatePrompt();
  }

  // ---- gesture arming (replaces talkMain button presses) -------------------

  private armedRight(handVisible: boolean): boolean {
    this.armCount = handVisible && this.now.x > ARM_X ? this.armCount + 1 : 0;
    return this.armCount >= ARM_TICKS;
  }

  private crosses(l: Line, leftwards: boolean): boolean {
    const dir = leftwards ? this.now.x < this.bak.x : this.bak.x < this.now.x;
    return dir && lineCrossPoint(l.x1, l.y1, l.x2, l.y2, this.bak.x, this.bak.y, this.now.x, this.now.y);
  }

  // ---- nagurikiseki: slap trajectory check ---------------------------------

  private startHitline() {
    this.hitResult = 0;
    this.hitline = { active: true, bound: this.state, step: 0, crit: false };
  }

  private updateHitline() {
    const h = this.hitline;
    if (!h.active) return;
    if (h.bound !== this.state) {
      h.active = false;
      return;
    }
    const s = this.stats;
    if (h.step === 0 && this.crosses(s.approach, true)) h.step = 1;
    if (h.step === 1 && this.crosses(s.cheek, true)) {
      h.step = 2;
      h.crit = true;
    }
    if (this.crosses(s.face, true)) {
      this.hitResult = h.crit ? 2 : 1;
      h.active = false;
    }
  }

  // ---- timebar / ret4 / ret5: turn switching -------------------------------

  private updateTimebar() {
    const tm = this.stats.timeSpeed;
    switch (this.timebar) {
      case "player":
        this.bar -= tm;
        if (this.bar <= 10) {
          this.bar = 10;
          this.timebar = "toEnemy";
        }
        break;
      case "toEnemy":
        if (this.state === 4) {
          // ret4
          this.timebar = "enemy";
          this.turn = "enemy";
          this.state = 10;
          this.armed = false;
        }
        break;
      case "enemy":
        this.bar += tm;
        if (this.bar >= 210) {
          this.bar = 210;
          this.timebar = "toPlayer";
        }
        break;
      case "toPlayer":
        if (this.state === 11) {
          // ret5
          this.timebar = "player";
          this.turn = "player";
          this.state = 3;
          this.armed = false;
        }
        break;
    }
  }

  // ---- damage --------------------------------------------------------------

  private enemySound(kind: "hit1" | "hit2" | "miss" | "finalhit") {
    const p = this.stats && ["saori", "saori", "mita", "hanae", "tsubaki"][this.enemyIndex];
    if (kind === "miss" && p === "saori") return "miss";
    return `${p}_${kind}`;
  }

  /** enemy_dmg — returns true when the enemy is knocked out */
  private enemyDamage(): boolean {
    const crit = this.hitResult === 2;
    const dmg = Math.floor(this.speed) * (crit ? 2 : 1);
    this.enemyHp -= dmg;
    this.emit(crit ? "crit" : "hit");
    if (this.practice && this.enemyHp < 1) {
      this.enemyHp = this.enemyMaxHp;
      this.bruise = 0;
    }
    this.shake = crit ? 10 : 6;
    this.flash = 3;
    this.popup(crit ? `${dmg}!!` : `${dmg}`, 300, 150, crit ? "#ffd84a" : "#fff");
    let ko = false;
    if (this.enemyHp < 1) {
      if (this.isBoss) {
        this.enemyPose = 7;
        this.state = 100;
        this.t = 0;
        this.sfx.stopBgm();
      } else {
        this.enemyPose = 8;
        this.state = 40;
      }
      this.sfx.play("reiko_finalhit");
      ko = true;
    } else {
      this.sfx.play(crit ? "reiko_hit2" : "reiko_hit1");
      this.enemyPose = crit ? 7 : 6;
    }
    const thresholds = [0.8, 0.6, 0.4, 0.2];
    if (this.bruise < 4 && this.enemyMaxHp * thresholds[this.bruise] > this.enemyHp) this.bruise++;
    return ko;
  }

  /** reikoDmg — returns true when Reiko is knocked out */
  private playerDamage(): boolean {
    const s = this.stats;
    const crit = s.luck > Math.random() * 100;
    const dmg = crit ? s.power * (2 + this.level / 2.5) : s.power + (s.power * Math.random()) / 2;
    if (!this.practice) this.playerHp -= dmg;
    this.emit("hurt");
    this.shake = crit ? 12 : 7;
    this.flash = 4;
    this.popup(this.practice ? "아야!" : `-${Math.round(dmg)}`, 560, 260, "#ff6b6b");
    if (this.playerHp < 1 && !this.muteki) {
      this.playerPose = 7;
      this.state = 30;
      this.sfx.play(this.enemySound("finalhit"));
      return true;
    }
    if (this.playerHp < 1) this.playerHp = 1;
    this.playerPose = crit ? 6 : 5;
    this.sfx.play(this.enemySound(crit ? "hit2" : "hit1"));
    return false;
  }

  private popup(text: string, x: number, y: number, color: string) {
    this.popups.push({ text, x, y, age: 0, color });
  }

  private setBanner(b: Banner) {
    this.banner = b;
    this.bannerAge = 0;
  }

  // ---- gameMainProg --------------------------------------------------------

  private gameMainProg(handVisible: boolean) {
    const s = this.stats;
    switch (this.state) {
      case 1: // short pause, then START
        if (++this.t === 15) {
          this.t = 0;
          this.state = 2;
        }
        break;
      case 2: // startDraw
        this.t++;
        if (this.t === 30) {
          this.setBanner("start");
          this.sfx.play("reiko_down");
        }
        if (this.t === 90) {
          this.setBanner(null);
          this.timebar = "player";
          this.state = 3;
        }
        break;

      // ---- player's turn ----
      case 3:
        this.playerPose = 1;
        this.enemyPose = 1;
        this.armCount = 0;
        this.state = 4;
        break;
      case 4: // waiting for "Attack"
        if (this.armedRight(handVisible)) {
          this.sfx.play("drugok");
          this.armed = true;
          this.t = 0;
          this.state = 5;
          this.startHitline();
        }
        break;
      case 5: // armed: slap her!
        this.t++;
        if (this.hitResult > 0) {
          this.lastSpeed = this.speed;
          this.armed = false;
          this.t = 0;
          this.state = 6;
          this.playerPose = 3;
          if (this.speed < s.speedNeeded) {
            // too slow — she sees it coming, dodges and slaps back
            this.enemyPose = 5;
            this.sfx.play("miss");
            this.popup("느려!", 300, 150, "#9fd3ff");
            this.emit("slow");
            this.state = 60;
            break;
          }
          if (s.luck > Math.random() * 100) {
            this.enemyPose = 5;
            this.sfx.play("miss");
            this.popup("MISS", 300, 150, "#9fd3ff");
            this.emit("miss");
          } else if (this.enemyDamage()) {
            return;
          }
        } else {
          if (this.now.x < s.whiffX) {
            this.armed = false;
            this.playerPose = 3;
            this.enemyPose = 5;
            this.sfx.play("miss");
            this.popup("MISS", 300, 150, "#9fd3ff");
            this.emit("whiff");
            this.t = 0;
            this.state = 6;
          }
          if (this.t > s.patience) {
            this.emit("late");
            this.armed = false;
            this.t = 4;
            this.state = 60;
          }
        }
        break;
      case 60: // she punishes a slow / late slap
        if (++this.t >= 5) {
          this.t = 0;
          this.enemyPose = 2;
          this.state = 61;
        }
        break;
      case 61:
        if (++this.t === 3) {
          this.enemyPose = 3;
          if (this.playerDamage()) break;
          this.t = 0;
          this.state = 6;
        }
        break;
      case 6:
        if (++this.t >= 15) this.state = 3;
        break;

      // ---- enemy's turn ----
      case 10:
        this.playerPose = 1;
        this.sfx.play("clickok");
        this.enemyPose = 2; // wind-up
        this.t = 0;
        this.evadeStep = 0;
        this.dodged = false;
        this.state = 11;
        break;
      case 11:
        this.t++;
        this.evadeCheck(handVisible);
        if (this.t > s.windup - s.release) {
          this.t = 0;
          this.state = 12;
        }
        break;
      case 12:
        this.t++;
        if (this.evadeStep === 1) this.evadeCheck(handVisible);
        if (this.t > s.release) {
          this.armed = false;
          this.enemyPose = 3; // strike
          this.t = 0;
          this.state = 13;
        }
        break;
      case 13:
        if (this.dodged) {
          this.sfx.play(this.enemySound("miss"));
          this.playerPose = 4;
          this.popup("회피!", 560, 260, "#9fd3ff");
          this.emit("dodge");
          this.armCount = 0;
          this.t = 0;
          // Evade drill skips the counter so you can focus on dodging
          this.state = this.practice === "evade" ? 20 : 70;
          break;
        }
        if (this.playerDamage()) break;
        this.t = 0;
        this.state = s.combo > Math.random() * 100 ? 50 : 20;
        break;
      case 70: // counter chance
        if (++this.t > s.counterWindow) {
          this.emit("counterMissed");
          this.enemyPose = 1;
          this.state = 20;
          this.t = 10;
          break;
        }
        if (this.armedRight(handVisible)) {
          this.sfx.play("drugok");
          this.armed = true;
          this.state = 72;
          this.startHitline();
        }
        break;
      case 72: // counter slap — she can't dodge this one
        this.t++;
        if (this.t > s.counterWindow) {
          this.emit("counterMissed");
          this.armed = false;
          this.enemyPose = 2;
          this.state = 80;
          this.t = 0;
          break;
        }
        if (this.hitResult > 0) {
          this.armed = false;
          this.playerPose = 3;
          this.lastSpeed = this.speed;
          this.emit("counter");
          if (this.enemyDamage()) return;
          this.state = 20;
          this.t = 5;
        }
        break;
      case 80: // missed the counter window
        if (++this.t > 5) {
          this.enemyPose = 3;
          if (this.playerDamage()) break;
          this.state = 20;
          this.t = 0;
        }
        break;
      case 20:
        if (++this.t > 15) {
          this.playerPose = 1;
          this.t = 0;
          this.state = 10;
        }
        break;
      case 50: // follow-up slap
        if (++this.t === 10) {
          this.t = 0;
          this.state = 51;
          this.enemyPose = 2;
          this.playerPose = 1;
        }
        break;
      case 51:
        if (++this.t === 5) {
          this.t = 0;
          this.state = 52;
          this.enemyPose = 3;
        }
        break;
      case 52:
        if (this.playerDamage()) break;
        this.t = 0;
        this.state = 20;
        break;

      // ---- endings ----
      case 30: // Reiko down
        this.timebar = "off";
        this.armed = false;
        this.sfx.stopBgm();
        this.setBanner("lose");
        this.t = 0;
        this.state = 31;
        break;
      case 31:
        if (++this.t > 120) {
          this.phase = "gameover";
          this.state = 32;
        }
        break;
      case 100: // boss knocked out — long pause before she falls
        if (++this.t === 60) {
          this.enemyPose = 8;
          this.sfx.play("tsubaki_out");
          this.state = 40;
        }
        break;
      case 40: // win
        this.timebar = "off";
        this.armed = false;
        this.sfx.stopBgm();
        this.setBanner("win");
        this.t = 0;
        this.state = 41;
        break;
      case 41:
        if (++this.t > (this.isBoss ? 240 : 90)) {
          if (this.level === 1) this.playerHp += 100;
          if (this.level === 2) this.playerHp += 50;
          this.playerHp = Math.min(this.playerHp, PLAYER_MAX_HP);
          if (this.enemyIndex + 1 >= ENEMY_COUNT) {
            this.phase = "clear";
            this.setBanner("clear");
            this.state = 42;
          } else {
            this.startBattle(this.enemyIndex + 1);
          }
        }
        break;
    }
  }

  /** Evade: arm with hand left of the dodge line, then swipe right across it. */
  private evadeCheck(handVisible: boolean) {
    if (this.bodyDodge) {
      this.bodyEvadeCheck();
      return;
    }
    if (this.evadeStep === 0) {
      if (handVisible && this.now.x < SW_LINE_X - 20) {
        this.evadeStep = 1;
        this.armed = true;
        this.sfx.play("drugok");
      }
      return;
    }
    if (this.evadeStep !== 1) return;
    // Original line was x=500, y 362..480 (bottom edge); a webcam needs the full height
    if (this.crosses({ x1: SW_LINE_X, y1: -1000, x2: SW_LINE_X, y2: 2000 }, false)) {
      this.armed = false;
      this.dodged = true;
      this.evadeStep = 100;
    }
  }

  /** Body evade: arm with your head at rest, then lean sideways or duck out of it. */
  private bodyEvadeCheck() {
    const o = this.headOffset;
    if (!o) return;
    if (this.evadeStep === 0) {
      if (Math.abs(o.dx) < HEAD_CENTER && Math.abs(o.dy) < HEAD_CENTER) {
        this.evadeStep = 1;
        this.armed = true;
        this.sfx.play("drugok");
      }
      return;
    }
    if (this.evadeStep !== 1) return;
    if (Math.abs(o.dx) > HEAD_DODGE_X || o.dy > HEAD_DODGE_DOWN) {
      this.armed = false;
      this.dodged = true;
      this.evadeStep = 100;
    }
  }

  private updatePrompt() {
    const st = this.state;
    if (st === 4) this.prompt = "attack";
    else if (st === 5) this.prompt = "slap";
    else if ((st === 11 || st === 12) && this.evadeStep === 0) this.prompt = this.bodyDodge ? "evadeBody" : "evade";
    else if ((st === 11 || st === 12) && this.evadeStep === 1) this.prompt = this.bodyDodge ? "dodgeBody" : "dodge";
    else if (st === 70 || st === 72) this.prompt = "counter";
    else this.prompt = null;
  }

  /** For the debug overlay */
  get hitLines() {
    return this.stats && { face: this.stats.face, cheek: this.stats.cheek, approach: this.stats.approach };
  }

  get hand(): Point {
    return this.now;
  }

  /** Movement speed this tick (px per 1/30 s, with gain) */
  get swingSpeed(): number {
    return this.speed;
  }
}
