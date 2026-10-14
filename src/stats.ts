// Enemy parameters recovered from duplex.ATask.inidata.

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface EnemyStats {
  hp: number;
  /** Lk: % chance to dodge a slap / % chance her slap is critical */
  luck: number;
  /** Pw: slap power */
  power: number;
  /** Ts: minimum slap speed (px per 1/30s) — slower slaps are dodged */
  speedNeeded: number;
  /** Ct: ticks before she loses patience and slaps you */
  patience: number;
  /** Dr: wind-up length (ticks) */
  windup: number;
  /** Rr: final part of the wind-up (ticks) */
  release: number;
  /** Face line (cross right->left to land a hit) */
  face: Line;
  /** Cheek line: crossing approach then cheek = critical (x2 damage) */
  cheek: Line;
  approach: Line;
  /** XX: passing left of this x without a hit = whiff */
  whiffX: number;
  /** KC: % chance of a follow-up slap */
  combo: number;
  /** hangeki: counter window (ticks) */
  counterWindow: number;
  /** Tm: time-bar speed */
  timeSpeed: number;
}

const L = (x1: number, y1: number, x2: number, y2: number): Line => ({ x1, y1, x2, y2 });

const BASE: EnemyStats[] = [
  { hp: 3000, luck: 5, power: 40, speedNeeded: 80, patience: 60, windup: 40, release: 2,
    face: L(297, 102, 275, 220), cheek: L(293, 156, 284, 201), approach: L(350, 183, 346, 203),
    whiffX: 150, combo: 2, counterWindow: 40, timeSpeed: 3 },
  { hp: 3500, luck: 8, power: 50, speedNeeded: 100, patience: 45, windup: 30, release: 4,
    face: L(292, 110, 277, 218), cheek: L(302, 157, 297, 192), approach: L(349, 178, 346, 193),
    whiffX: 150, combo: 25, counterWindow: 30, timeSpeed: 2 },
  { hp: 4500, luck: 15, power: 70, speedNeeded: 130, patience: 50, windup: 35, release: 4,
    face: L(286, 138, 245, 245), cheek: L(292, 211, 268, 235), approach: L(332, 236, 324, 251),
    whiffX: 150, combo: 6, counterWindow: 45, timeSpeed: 3 },
  { hp: 3300, luck: 40, power: 120, speedNeeded: 160, patience: 30, windup: 30, release: 4,
    face: L(282, 87, 264, 210), cheek: L(297, 157, 293, 179), approach: L(366, 150, 363, 170),
    whiffX: 130, combo: 15, counterWindow: 25, timeSpeed: 4 },
  { hp: 7000, luck: 30, power: 160, speedNeeded: 170, patience: 45, windup: 40, release: 6,
    face: L(211, 70, 194, 159), cheek: L(237, 114, 237, 142), approach: L(304, 118, 304, 134),
    whiffX: 50, combo: 2, counterWindow: 30, timeSpeed: 5 },
];

/** Level scaling from the end of inidata (level 1..4). */
export function enemyStats(index: number, level: number): EnemyStats {
  const s = { ...BASE[index] };
  const k = level - 1;
  s.hp += (s.hp / 4) * k;
  s.luck += (s.luck / 4) * k;
  s.power += 3 * k;
  s.windup -= 2 * k;
  s.counterWindow -= 2 * k;
  return s;
}

export const ENEMY_COUNT = BASE.length;
/** Reiko's HP rules from Game_system */
export const PLAYER_START_HP = 1000;
export const PLAYER_MAX_HP = 1500;
export const SW_LINE_X = 500;
