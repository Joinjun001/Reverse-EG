// Loads public/assets-original (built by re/build_assets.py from the extracted SWF).

const BASE = "assets-original/";

export interface EnemyArt {
  name: string;
  title: string;
  sound: string;
  poses: Record<string, HTMLImageElement>;
  bruise: { at: [number, number]; frames: HTMLImageElement[] };
  strikeOverlay?: { img: HTMLImageElement; at: [number, number] };
}

export interface Art {
  enemies: EnemyArt[];
  player: { at: [number, number]; poses: Record<string, HTMLImageElement> };
  ui: Record<string, HTMLImageElement>;
}

interface Manifest {
  enemies: {
    name: string;
    title: string;
    sound: string;
    poses: Record<string, string>;
    bruise: { at: [number, number]; frames: string[] };
    strikeOverlay?: { img: string; at: [number, number] };
  }[];
  player: { at: [number, number]; poses: Record<string, string> };
  ui: Record<string, string>;
  sounds: Record<string, string>;
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${path}`));
    img.src = BASE + path;
  });
}

async function mapValues<T>(rec: Record<string, string>, f: (v: string) => Promise<T>) {
  const entries = await Promise.all(Object.entries(rec).map(async ([k, v]) => [k, await f(v)] as const));
  return Object.fromEntries(entries) as Record<string, T>;
}

export class Sound {
  private buffers = new Map<string, AudioBuffer>();
  private bgm: AudioBufferSourceNode | null = null;
  private bgmKey = "";
  private gain: GainNode;

  constructor(private ctx: AudioContext) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.8;
    this.gain.connect(ctx.destination);
  }

  async load(sounds: Record<string, string>) {
    await Promise.all(
      Object.entries(sounds).map(async ([key, path]) => {
        const res = await fetch(BASE + path);
        this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  play(key: string) {
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start();
  }

  playBgm(key: string) {
    if (this.bgmKey === key) return;
    this.stopBgm();
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.45;
    src.connect(g).connect(this.gain);
    src.start();
    this.bgm = src;
    this.bgmKey = key;
  }

  stopBgm() {
    this.bgm?.stop();
    this.bgm = null;
    this.bgmKey = "";
  }
}

export async function loadAssets(audio: AudioContext): Promise<{ art: Art; sound: Sound }> {
  const res = await fetch(BASE + "manifest.json");
  if (!res.ok) throw new Error("assets missing — run `npm run assets` first");
  const m: Manifest = await res.json();

  const enemies = await Promise.all(
    m.enemies.map(async (e): Promise<EnemyArt> => ({
      name: e.name,
      title: e.title,
      sound: e.sound,
      poses: await mapValues(e.poses, loadImage),
      bruise: { at: e.bruise.at, frames: await Promise.all(e.bruise.frames.map(loadImage)) },
      strikeOverlay: e.strikeOverlay && { img: await loadImage(e.strikeOverlay.img), at: e.strikeOverlay.at },
    })),
  );
  const art: Art = {
    enemies,
    player: { at: m.player.at, poses: await mapValues(m.player.poses, loadImage) },
    ui: await mapValues(m.ui, loadImage),
  };
  const sound = new Sound(audio);
  await sound.load(m.sounds);
  return { art, sound };
}
