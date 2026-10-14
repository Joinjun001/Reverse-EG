"""Find where a sprite PNG (exported canvas) sits on a stage frame PNG.

Usage: python3 -I re/locate_sprite.py <sprite.png> <frame.png>
Prints the stage (x, y) of the sprite canvas's top-left corner and the match error.
Uses alpha-masked SSD: coarse search at 1/4 scale, then refine at full scale.
"""
import sys

import numpy as np
from PIL import Image


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32)


def best(sprite, frame, xs, ys):
    rgb, a = sprite[..., :3], sprite[..., 3:] / 255.0
    h, w = sprite.shape[:2]
    fh, fw = frame.shape[:2]
    res = None
    for y in ys:
        for x in xs:
            # Sprite may hang off the stage edge: compare only the overlapping part
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + w, fw), min(y + h, fh)
            if x1 - x0 < w // 3 or y1 - y0 < h // 3:
                continue
            s = rgb[y0 - y:y1 - y, x0 - x:x1 - x]
            m = a[y0 - y:y1 - y, x0 - x:x1 - x]
            if m.sum() < 1:
                continue
            f = frame[y0:y1, x0:x1, :3]
            err = float((((s - f) ** 2) * m).sum() / (m.sum() * 3))
            if res is None or err < res[0]:
                res = (err, x, y)
    return res


sprite_full = load(sys.argv[1])
frame_full = load(sys.argv[2])

# Crop sprite to its opaque bounding box to keep the search small
ys_, xs_ = np.nonzero(sprite_full[..., 3] > 200)
by0, by1, bx0, bx1 = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
crop = sprite_full[by0:by1, bx0:bx1]

k = 4
small = lambda arr: arr[::k, ::k]
ch, cw = crop.shape[:2]
fh, fw = frame_full.shape[:2]
coarse = best(small(crop), small(frame_full),
              range(-cw // k, fw // k), range(-ch // k, fh // k))
_, cx, cy = coarse
fine = best(crop, frame_full, range(cx * k - 6, cx * k + 7), range(cy * k - 6, cy * k + 7))
err, x, y = fine
print(f"canvas_origin=({x - bx0}, {y - by0}) bbox_on_stage=({x},{y},{x + cw},{y + ch}) err={err:.1f}")
