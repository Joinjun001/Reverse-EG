"""Build a labeled contact sheet from a list of PNG paths.

Usage: python3 -I re/contact_sheet.py <out.png> <cell_px> <png> [<png> ...]
"""
import os
import sys

from PIL import Image, ImageDraw

out, cell = sys.argv[1], int(sys.argv[2])
paths = sys.argv[3:]
cols = min(8, len(paths))
rows = (len(paths) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + 14)), (200, 200, 200))
draw = ImageDraw.Draw(sheet)
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGBA")
    im.thumbnail((cell, cell))
    x, y = (i % cols) * cell, (i // cols) * (cell + 14)
    sheet.paste(im, (x, y + 14), im)
    label = os.path.relpath(p).replace("DefineSprite_", "S").replace("sprites/", "")
    draw.text((x + 2, y + 1), label[-28:], fill=(0, 0, 0))
sheet.save(out)
print(out, sheet.size)
