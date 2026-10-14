"""Query layout info from a JPEXS swf2xml dump.

Usage: python3 -I re/swf_layout.py <swf.xml> <characterId> [<characterId> ...]
For each character prints: who places it (parent sprite / main timeline), depth, name, matrix;
for shapes also the bounds (px) and the bitmap it fills with.
"""
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
targets = set(sys.argv[2:])
TW = 20.0


def mat(el):
    m = el.find("matrix")
    if m is None:
        return None
    g = lambda k, d: float(m.get(k, d))
    return dict(sx=g("scaleX", 1), sy=g("scaleY", 1), r0=g("rotateSkew0", 0), r1=g("rotateSkew1", 0),
                tx=g("translateX", 0) / TW, ty=g("translateY", 0) / TW)


def walk(tags, parent):
    frame = 1
    for t in tags:
        ty = t.get("type", "")
        if ty == "ShowFrameTag":
            frame += 1
        elif ty.startswith("PlaceObject") and t.get("characterId") in targets:
            print(f"{t.get('characterId')}: placed in {parent} frame {frame} depth {t.get('depth')} "
                  f"name={t.get('name')} matrix={mat(t)}")
        elif ty == "DefineSpriteTag":
            walk(t.find("subTags"), f"sprite {t.get('spriteId')}")
        elif ty.startswith("DefineShape") and t.get("shapeId") in targets:
            b = t.find("shapeBounds")
            bmp = [f.get("bitmapId") for f in t.iter("item") if f.get("bitmapId") and f.get("bitmapId") != "65535"]
            print(f"{t.get('shapeId')}: shape bounds px=({int(b.get('Xmin'))/TW},{int(b.get('Ymin'))/TW},"
                  f"{int(b.get('Xmax'))/TW},{int(b.get('Ymax'))/TW}) bitmaps={bmp}")


walk(root.find("tags"), "main")
