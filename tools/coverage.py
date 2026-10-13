#!/usr/bin/env python3
"""Report static translation coverage, not runtime gameplay coverage."""
import collections
import json
from pathlib import Path

manifest = json.loads(Path("recompiled/generated/program_manifest.json").read_text())
nodes = manifest["nodes"]
counts = collections.Counter(node["disposition"] for node in nodes.values())
print("Static CPU-state variants:", dict(counts))
print("Interpreter-only entries:")
for key, node in nodes.items():
    if node["disposition"] == "lle_only":
        print(f"  {key}: {', '.join(node['reasons'])}")
print("These counts do not establish whole-game coverage or playability.")
