"""Substitute JPEXS `§§constant(N)` placeholders with values from a P-code ConstantPool.

Usage: python3 -I re/resolve_constants.py <file.pcode> <file.as> <out.as>
Picks the largest ConstantPool in the P-code file (the real one; small pools are decoys).
"""
import re
import sys

pcode_path, as_path, out_path = sys.argv[1:4]

pools = []
for line in open(pcode_path, encoding="utf-8", errors="replace"):
    if line.startswith("ConstantPool "):
        pools.append(re.findall(r'"((?:[^"\\]|\\.)*)"', line))
pool = max(pools, key=len)

src = open(as_path, encoding="utf-8", errors="replace").read()


def sub(m):
    i = int(m.group(1))
    return f'"{pool[i]}"' if i < len(pool) else m.group(0)


src = re.sub(r"§§constant\((\d+)\)", sub, src)
# obj["name"] -> obj.name when name is a valid identifier
src = re.sub(r'\["([A-Za-z_$][\w$]*)"\]', r".\1", src)
open(out_path, "w", encoding="utf-8").write(src)
print(f"pool size {len(pool)}; remaining placeholders: {src.count('§§constant')}")
