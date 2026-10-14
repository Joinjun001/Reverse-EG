// Guided tutorial: webcam setup (+ automatic swing calibration), then one drill per move.

import type { Game, GameEvent, Lesson } from "./game";
import type { Point } from "./geometry";

export type Step = "see" | "reach" | "swing" | "attack" | "crit" | "evade" | "counter" | "done";

interface StepInfo {
  label: string;
  title: string;
  text: string;
  goal: number;
  lesson?: Lesson;
}

const STEPS: Record<Step, StepInfo> = {
  see: {
    label: "웹캠 세팅 1/3",
    title: "손 보여주기",
    text: "카메라에서 한두 걸음 떨어져서, 손바닥을 카메라 쪽으로 보여주세요.",
    goal: 1,
  },
  reach: {
    label: "웹캠 세팅 2/3",
    title: "움직일 범위 확인",
    text: "손을 화면 오른쪽 끝, 왼쪽 끝까지 움직여 보세요. 분홍 점이 손을 따라가요.",
    goal: 2,
  },
  swing: {
    label: "웹캠 세팅 3/3",
    title: "감도 맞추기",
    text: "평소 때리듯이 오른쪽 → 왼쪽으로 빠르게 3번 휘둘러 보세요. 그 속도로 감도를 맞춰요.",
    goal: 3,
  },
  attack: {
    label: "연습 1/4",
    title: "공격",
    text: "손을 오른쪽에 두면 준비돼요. 그다음 빨간 선(얼굴)을 지나가게 ← 빠르게 휘두르세요.",
    goal: 3,
    lesson: "attack",
  },
  crit: {
    label: "연습 2/4",
    title: "크리티컬",
    text: "조금 낮게, 초록 선 → 노란 선(볼)을 차례로 지나가게 휘두르면 데미지 ×2예요.",
    goal: 1,
    lesson: "attack",
  },
  evade: {
    label: "연습 3/4",
    title: "회피",
    text: "상대가 손을 들면 내 손을 왼쪽에 두세요. 상대가 때리기 직전에 파란 선을 넘어 → 오른쪽으로 휙!",
    goal: 2,
    lesson: "evade",
  },
  counter: {
    label: "연습 4/4",
    title: "반격",
    text: "피하면 반격 찬스예요. 피한 직후 바로 오른쪽에서 ← 휘두르세요. 반격은 상대가 못 피해요.",
    goal: 2,
    lesson: "counter",
  },
  done: {
    label: "완료",
    title: "튜토리얼 완료!",
    text: "실전에서는 상대도 피하고, 반격하고, 내 체력도 줄어요. 화이팅!",
    goal: 0,
  },
};

/** Difficulty 3+: you dodge with your body, so these steps read differently */
const BODY_TEXT: Partial<Record<Step, string>> = {
  see: "카메라에서 한두 걸음 떨어져서, 손바닥과 얼굴이 둘 다 카메라에 보이게 서 주세요.",
  evade: "상대가 손을 들면 몸을 가운데에 두세요. 때리기 직전에 몸(고개)을 옆으로 빼거나 숙이면 피해요. 미리보기의 파란 점선 밖으로!",
  counter: "몸으로 피하면 반격 찬스예요. 피한 직후 바로 손을 오른쪽에서 ← 휘두르세요.",
};

const ORDER: Step[] = ["see", "reach", "swing", "attack", "crit", "evade", "counter", "done"];

/** Swing speed (with gain) a normal swing should reach: beats the first three opponents, not the last two. */
const TARGET_SPEED = 150;
const SEE_TICKS = 30;

export interface SetupView {
  step: Step;
  seeProgress: number;
  reachedLeft: boolean;
  reachedRight: boolean;
  swings: number[];
  livePeak: number;
}

export class Tutorial {
  step: Step;
  count = 0;
  feedback = "";
  /** Set once the swing step measured you */
  calibratedGain: number | null = null;

  private seeTicks = 0;
  private reachedLeft = false;
  private reachedRight = false;
  private swings: number[] = [];
  private swingPeak = 0;
  private quietTicks = 0;
  private doneTimer = 0;

  constructor(
    private game: Game,
    hasCamera: boolean,
    private onChange: () => void,
    private setGain: (g: number) => void,
  ) {
    game.onEvent = (e) => this.onEvent(e);
    this.step = hasCamera ? "see" : "attack";
    this.enter(this.step);
  }

  get info(): StepInfo {
    const base = STEPS[this.step];
    const body = this.game.bodyDodge ? BODY_TEXT[this.step] : undefined;
    return body ? { ...base, text: body } : base;
  }

  get inSetup(): boolean {
    return this.step === "see" || this.step === "reach" || this.step === "swing";
  }

  /** Show the hit lines while drilling */
  get showLines(): boolean {
    return !this.inSetup && this.step !== "done";
  }

  get setupView(): SetupView {
    return {
      step: this.step,
      seeProgress: Math.min(1, this.seeTicks / SEE_TICKS),
      reachedLeft: this.reachedLeft,
      reachedRight: this.reachedRight,
      swings: this.swings,
      livePeak: this.swingPeak,
    };
  }

  skip() {
    this.advance();
  }

  restart() {
    this.step = "see";
    this.seeTicks = 0;
    this.reachedLeft = this.reachedRight = false;
    this.swings = [];
    this.enter(this.step);
  }

  dispose() {
    this.game.onEvent = null;
  }

  /** Called each 1/30 s during setup steps with the raw (un-gained) hand stroke. */
  setupTick(stroke: { from: Point; to: Point; speed: number } | null, visible: boolean, faceVisible: boolean) {
    if (this.doneTimer > 0) {
      if (--this.doneTimer === 0) this.advance();
      return;
    }
    const to = stroke?.to;
    switch (this.step) {
      case "see":
        // body-dodge difficulties also need your face in frame
        this.seeTicks = visible && (faceVisible || !this.game.bodyDodge) ? this.seeTicks + 1 : Math.max(0, this.seeTicks - 2);
        if (this.seeTicks >= SEE_TICKS) this.succeed();
        break;
      case "reach":
        if (visible && to) {
          if (to.x > 580 && !this.reachedRight) this.reachedRight = this.progress("오른쪽 끝 ✓");
          if (to.x < 150 && !this.reachedLeft) this.reachedLeft = this.progress("왼쪽 끝 ✓");
        }
        break;
      case "swing":
        this.trackSwing(stroke, visible);
        break;
    }
  }

  private trackSwing(stroke: { from: Point; to: Point; speed: number } | null, visible: boolean) {
    const leftward = stroke && stroke.to.x < stroke.from.x;
    if (visible && stroke && leftward && stroke.speed > 15) {
      this.swingPeak = Math.max(this.swingPeak, stroke.speed);
      this.quietTicks = 0;
      return;
    }
    if (this.swingPeak === 0) return;
    if (++this.quietTicks < 4) return;
    // swing finished
    const peak = this.swingPeak;
    this.swingPeak = 0;
    this.quietTicks = 0;
    if (peak < 30) {
      this.say("조금 더 빠르게 휘둘러 보세요");
      return;
    }
    this.swings.push(peak);
    this.count = this.swings.length;
    if (this.swings.length < STEPS.swing.goal) {
      this.say(`${this.swings.length}번째 스윙 ✓`);
      return;
    }
    const sorted = [...this.swings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const gain = Math.min(8, Math.max(1, Math.round((TARGET_SPEED / median) * 2) / 2));
    this.calibratedGain = gain;
    this.setGain(gain);
    this.say(`감도를 ×${gain.toFixed(1)}로 맞췄어요`);
    this.doneTimer = 45;
  }

  private onEvent(e: GameEvent) {
    const s = this.step;
    if (this.doneTimer > 0) return;
    const good = (msg: string) => this.progress(msg);
    switch (e) {
      case "hit":
        if (s === "attack") good("맞혔어요!");
        else if (s === "crit") this.say("맞혔어요! 이번엔 조금 더 낮게, 노란 선(볼)까지 지나가게");
        break;
      case "crit":
        if (s === "attack" || s === "crit") good("크리티컬! ×2");
        break;
      case "slow":
        this.say("느려요! 더 빠르게 — 아래 속도 막대가 흰 눈금을 넘어야 해요");
        break;
      case "whiff":
        this.say("얼굴(빨간 선)을 안 지나갔어요. 얼굴 높이로 휘두르세요");
        break;
      case "late":
        this.say("준비한 채로 너무 오래 기다리면 상대가 먼저 때려요");
        break;
      case "dodge":
        if (s === "evade") good("피했어요!");
        else if (s === "counter") this.say("피했어요! 지금 오른쪽에서 ← 반격!");
        break;
      case "hurt":
        if (s === "evade" || s === "counter")
          this.say(
            this.game.bodyDodge
              ? "맞았어요. 몸을 가운데에 뒀다가, 때리기 직전에 옆으로 크게 빼거나 숙이세요"
              : "맞았어요. 상대가 손을 들면 미리 손을 왼쪽에 뒀다가, 때리기 직전에 → 휙",
          );
        break;
      case "counter":
        if (s === "counter") good("반격 성공!");
        break;
      case "counterMissed":
        if (s === "counter") this.say("반격 시간이 지났어요. 피하자마자 바로 오른쪽에서 휘두르세요");
        break;
    }
  }

  /** Called every game tick during drills (to time the hand-off to the next step). */
  drillTick() {
    if (this.doneTimer > 0 && --this.doneTimer === 0) this.advance();
  }

  private progress(msg: string): true {
    this.count++;
    if (this.count >= this.info.goal) {
      this.succeed(msg);
    } else {
      this.say(`${msg} (${this.count}/${this.info.goal})`);
    }
    return true;
  }

  private succeed(msg = "좋아요!") {
    this.count = this.info.goal;
    this.say(`${msg} 다음 단계로 넘어가요`);
    this.doneTimer = 40;
  }

  private say(msg: string) {
    this.feedback = msg;
    this.onChange();
  }

  private advance() {
    this.doneTimer = 0;
    const next = ORDER[Math.min(ORDER.indexOf(this.step) + 1, ORDER.length - 1)];
    this.enter(next);
  }

  private enter(step: Step) {
    const prevLesson = STEPS[this.step].lesson;
    this.step = step;
    this.count = 0;
    this.feedback = "";
    const lesson = STEPS[step].lesson;
    // attack -> crit keeps the same drill running
    if (lesson && (lesson !== prevLesson || step === "attack")) this.game.startPractice(lesson);
    this.onChange();
  }
}
