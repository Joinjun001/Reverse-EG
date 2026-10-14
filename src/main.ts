import "./style.css";
import { loadAssets } from "./assets";
import { Game } from "./game";
import { HandTracker, MousePointer, type Pointer } from "./hand";
import { Renderer, STAGE_H, STAGE_W } from "./render";
import { Tutorial } from "./tutorial";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>("#stage");
canvas.width = STAGE_W;
canvas.height = STAGE_H;
const ctx = canvas.getContext("2d")!;

const title = $<HTMLElement>("#title");
const status = $<HTMLParagraphElement>("#status");
const startBtn = $<HTMLButtonElement>("#start");
const tutorialBtn = $<HTMLButtonElement>("#tutorial");
const radioValue = (name: string) => $<HTMLInputElement>(`input[name="${name}"]:checked`).value;
const gainInput = $<HTMLInputElement>("#gain");
const gainLabel = $<HTMLOutputElement>("#gain-value");
const endScreen = $<HTMLDivElement>("#end");
const endText = $<HTMLHeadingElement>("#end-text");
const coach = {
  root: $<HTMLElement>("#coach"),
  label: $<HTMLElement>("#coach-label"),
  title: $<HTMLElement>("#coach-title"),
  text: $<HTMLElement>("#coach-text"),
  progress: $<HTMLElement>("#coach-progress"),
  feedback: $<HTMLElement>("#coach-feedback"),
  skip: $<HTMLButtonElement>("#coach-skip"),
  exit: $<HTMLButtonElement>("#coach-exit"),
  play: $<HTMLButtonElement>("#coach-play"),
  again: $<HTMLButtonElement>("#coach-again"),
};

const params = new URLSearchParams(location.search);
if (params.get("input") === "mouse") $<HTMLInputElement>('input[name="input"][value="mouse"]').checked = true;

/** Webcam strokes are much shorter than mouse flicks; this scales hand speed to the original's mouse units. */
const GAIN_KEY = "slap.gain";
let gain = Number(gainInput.value);
try {
  const saved = Number(localStorage.getItem(GAIN_KEY));
  if (saved >= 1 && saved <= 8) gain = saved;
} catch {
  /* storage unavailable: keep default */
}
const showGain = () => {
  gainInput.value = String(gain);
  gainLabel.textContent = `×${gain.toFixed(1)}`;
};
const setGain = (g: number) => {
  gain = g;
  showGain();
  try {
    localStorage.setItem(GAIN_KEY, String(g));
  } catch {
    /* ignore */
  }
};
gainInput.addEventListener("input", () => setGain(Number(gainInput.value)));
showGain();

startBtn.addEventListener("click", () => boot(false));
tutorialBtn.addEventListener("click", () => boot(true));

async function boot(withTutorial: boolean) {
  startBtn.disabled = tutorialBtn.disabled = true;
  try {
    status.textContent = "원본 에셋 불러오는 중...";
    const audio = new AudioContext();
    const { art, sound } = await loadAssets(audio);

    let pointer: Pointer;
    let cam: HandTracker | null = null;
    if (radioValue("input") === "camera") {
      status.textContent = "카메라 + 손 인식 모델 준비 중... (처음엔 몇 초 걸려요)";
      cam = new HandTracker(STAGE_W, STAGE_H);
      await cam.start();
      pointer = cam;
    } else {
      pointer = new MousePointer(canvas, STAGE_W, STAGE_H);
      gain = 1; // mouse is already in the original's units
    }

    title.hidden = true;
    const game = new Game(sound, Number(radioValue("level")));
    game.webcam = cam !== null;
    if (cam) cam.trackFace = game.bodyDodge;
    if (!withTutorial) game.newRun();
    if (import.meta.env.DEV) Object.assign(window, { __game: game, __cam: cam });
    run(game, new Renderer(ctx, art), pointer, cam, withTutorial);
  } catch (err) {
    console.error(err);
    status.textContent = `시작 실패: ${(err as Error).message}`;
    startBtn.disabled = tutorialBtn.disabled = false;
  }
}

function run(game: Game, renderer: Renderer, pointer: Pointer, cam: HandTracker | null, withTutorial: boolean) {
  let debug = params.has("debug");
  let showCam = true;
  let acc = 0;
  let prev = performance.now();
  const TICK = 1000 / 30;
  let tutorial: Tutorial | null = null;

  const renderCoach = () => {
    if (!tutorial) return;
    const info = tutorial.info;
    const done = tutorial.step === "done";
    coach.label.textContent = info.label;
    coach.title.textContent = info.title;
    coach.text.textContent = info.text;
    coach.progress.replaceChildren(
      ...Array.from({ length: info.goal }, (_, i) => {
        const dot = document.createElement("span");
        if (i < tutorial!.count) dot.className = "on";
        return dot;
      }),
    );
    coach.feedback.textContent = tutorial.feedback;
    coach.skip.hidden = done;
    coach.exit.hidden = done;
    coach.play.hidden = !done;
    coach.again.hidden = !done;
  };

  const startTutorial = () => {
    tutorial?.dispose();
    document.body.classList.add("tutorial");
    coach.root.hidden = false;
    tutorial = new Tutorial(game, cam !== null, renderCoach, setGain);
    if (import.meta.env.DEV) Object.assign(window, { __tutorial: tutorial });
    renderCoach();
  };

  const endTutorial = () => {
    tutorial?.dispose();
    tutorial = null;
    document.body.classList.remove("tutorial");
    coach.root.hidden = true;
  };

  coach.skip.addEventListener("click", () => tutorial?.skip());
  coach.exit.addEventListener("click", restart);
  coach.play.addEventListener("click", restart);
  coach.again.addEventListener("click", startTutorial);
  if (withTutorial) startTutorial();

  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") debug = !debug;
    if (e.key === "r" || e.key === "R") restart();
    if (e.key === "c" || e.key === "C") showCam = !showCam;
    // The shipped Flash build still had debug=true: number keys pick an enemy, invincible
    if (e.key >= "1" && e.key <= "5") {
      endTutorial();
      game.muteki = true;
      game.newRun(game.level, Number(e.key) - 1);
      endScreen.hidden = true;
    }
  });
  $<HTMLButtonElement>("#retry").addEventListener("click", restart);

  function restart() {
    endTutorial();
    game.muteki = false;
    game.newRun();
    endScreen.hidden = true;
  }

  function frame(now: number) {
    pointer.update(now);
    acc += Math.min(now - prev, 250);
    prev = now;
    while (acc >= TICK) {
      acc -= TICK;
      const s = pointer.takeStroke();
      game.head = cam?.face ?? null;
      if (tutorial?.inSetup) {
        tutorial.setupTick(s, pointer.visible, game.head !== null);
      } else {
        game.tick(s && { from: s.from, to: s.to, speed: s.speed * gain }, pointer.visible);
        tutorial?.drillTick();
      }
    }
    const hand = pointer.visible ? game.hand : null;
    if (tutorial?.inSetup) {
      renderer.drawSetup(tutorial.setupView, cam, pointer.visible ? (pointer.lastPoint ?? null) : null, gain, game.bodyDodge);
    } else {
      renderer.draw(game, hand, showCam ? cam : null, debug || (tutorial?.showLines ?? false));
    }

    if (game.phase !== "battle" && endScreen.hidden) {
      endText.textContent = game.phase === "clear" ? "ALL CLEAR — 축하해요!" : "GAME OVER";
      endScreen.hidden = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
