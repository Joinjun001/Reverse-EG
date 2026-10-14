"""Copy the extracted original assets the web game needs into public/assets-original/.

Usage: python3 -I re/build_assets.py   (run from the repo root)

All positions are stage pixels (728x480), derived from the SWF placement matrices
(see re/swf_layout.py). The output folder is gitignored: it holds copyrighted art.
"""
import json
import shutil
from pathlib import Path

SRC = Path("assets-original")
OUT = Path("public/assets-original")

# Enemy sprite (holder 316 frame N) -> pose bitmap per enemy1 frame, all placed at stage (0,0).
# Frame meaning (from Game_system): 1 idle, 2 wind-up, 3 strike, 5 dodge, 6 hit, 7 critical hit.
ENEMIES = [
    dict(name="Saori Tsubakikoji", title="Younger Daughter", sound="saori",
         poses={1: 110, 2: 202, 3: 204, 5: 206, 6: 208, 7: 212},
         bruise=dict(at=(241, 139), frames=[194, 196, 198, 123])),
    dict(name="Shizuka Tsubakikoji", title="Elder Daughter", sound="saori",
         poses={1: 127, 2: 227, 3: 229, 5: 233, 6: 235, 7: 237},
         strike_overlay=dict(img=231, at=(252, 139)),
         bruise=dict(at=(252, 139), frames=[218, 220, 222, 224])),
    dict(name="Etsuko Mita", title="Housekeeper", sound="mita",
         poses={1: 139, 2: 252, 3: 254, 5: 256, 6: 144, 7: 258},
         bruise=dict(at=(236, 153), frames=[243, 245, 247, 249])),
    dict(name="Hanae Tsubakikoji", title="Matriarch", sound="hanae",
         poses={1: 153, 2: 274, 3: 276, 5: 153, 6: 279, 7: 281},
         bruise=dict(at=(234, 122), frames=[264, 266, 268, 270])),
    dict(name="Madame Camellia", title="Grand Madame", sound="tsubaki",
         poses={1: 289, 2: 300, 3: 302, 5: 306, 6: 308, 7: 310},
         strike_overlay=dict(img=304, at=(147, 74)),
         bruise=dict(at=(147, 74), frames=[291, 293, 295, 297])),
]
# Player sprite 332 at stage (208,120): 1 idle, 2 raise hand, 3 slap, 4 dodge, 5 hit, 6 critical hit
PLAYER = dict(at=(208, 120), poses={1: 317, 2: 319, 3: 321, 4: 323, 5: 325, 6: 327})

SPRITES = {
    "background": ("sprites/DefineSprite_193/1.png", "bg_normal.png"),
    "background_boss": ("sprites/DefineSprite_193/2.png", "bg_boss.png"),
    "btn_attack": ("sprites/DefineSprite_348/1.png", "btn_attack.png"),
    "btn_evade": ("sprites/DefineSprite_353/1.png", "btn_evade.png"),
    "btn_counter": ("sprites/DefineSprite_358/1.png", "btn_counter.png"),
    # life_* frame 3 = bloom, frame 4 = scattered petals; text frame 1 is blank (fade-in), so take a later one
    "life_camellia": ("sprites/DefineSprite_43_life_camellia/3.png", "life_camellia.png"),
    "life_camellia_lost": ("sprites/DefineSprite_43_life_camellia/4.png", "life_camellia_lost.png"),
    "life_rose": ("sprites/DefineSprite_46_life_rose/3.png", "life_rose.png"),
    "life_rose_lost": ("sprites/DefineSprite_46_life_rose/4.png", "life_rose_lost.png"),
    "text_start": ("sprites/DefineSprite_38_mcText_start/18.png", "text_start.png"),
    "text_win": ("sprites/DefineSprite_36_mcText_win/22.png", "text_win.png"),
    "text_lose": ("sprites/DefineSprite_34_mcText_lose/22.png", "text_lose.png"),
}


def img_path(bitmap_id):
    for ext in ("png", "jpg"):
        p = SRC / "images" / f"{bitmap_id}.{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(bitmap_id)


def copy_bitmap(bitmap_id):
    p = img_path(bitmap_id)
    dst = OUT / "img" / p.name
    shutil.copyfile(p, dst)
    return f"img/{p.name}"


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "img").mkdir(parents=True)
    (OUT / "snd").mkdir()

    manifest = {"stage": [728, 480], "enemies": [], "player": {}, "ui": {}, "sounds": {}}
    for e in ENEMIES:
        entry = {
            "name": e["name"], "title": e["title"], "sound": e["sound"],
            "poses": {str(k): copy_bitmap(v) for k, v in e["poses"].items()},
            "bruise": {"at": e["bruise"]["at"], "frames": [copy_bitmap(b) for b in e["bruise"]["frames"]]},
        }
        if "strike_overlay" in e:
            entry["strikeOverlay"] = {"img": copy_bitmap(e["strike_overlay"]["img"]), "at": e["strike_overlay"]["at"]}
        manifest["enemies"].append(entry)

    manifest["player"] = {"at": PLAYER["at"], "poses": {str(k): copy_bitmap(v) for k, v in PLAYER["poses"].items()}}

    for key, (src, name) in SPRITES.items():
        shutil.copyfile(SRC / src, OUT / "img" / name)
        manifest["ui"][key] = f"img/{name}"

    for p in sorted((SRC / "sounds").glob("*.mp3")):
        key = p.stem.split("_", 1)[1]  # "8_saori_hit1" -> "saori_hit1"
        shutil.copyfile(p, OUT / "snd" / f"{key}.mp3")
        manifest["sounds"][key] = f"snd/{key}.mp3"

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote {OUT}/manifest.json: {len(manifest['enemies'])} enemies, "
          f"{len(manifest['sounds'])} sounds, {len(list((OUT / 'img').iterdir()))} images")


if __name__ == "__main__":
    main()
