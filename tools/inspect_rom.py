#!/usr/bin/env python3
"""Inspect the exact supplied cartridge without executing or modifying it."""
import hashlib
import json
from pathlib import Path
import sys
import zlib

rom = Path(sys.argv[1] if len(sys.argv) > 1 else
           "Smash Tennis (axekin.com).sfc")
data = rom.read_bytes()
expected = "09fdef0c959e7275563f65d8267d95a20104f054e9438e9ac739ef7f46120a2d"
digest = hashlib.sha256(data).hexdigest()
if digest != expected:
    sys.exit("ROM differs from the inspected Smash Tennis image; refusing fixed offsets")

def word(offset):
    return int.from_bytes(data[offset:offset + 2], "little")

vectors = {name: f"00:{word(offset):04X}" for name, offset in {
    "native_cop": 0x7FE4, "native_brk": 0x7FE6,
    "native_abort": 0x7FE8, "native_nmi": 0x7FEA,
    "native_irq": 0x7FEE, "emulation_cop": 0x7FF4,
    "emulation_abort": 0x7FF8, "emulation_nmi": 0x7FFA,
    "reset": 0x7FFC, "emulation_irq_brk": 0x7FFE,
}.items()}
print(json.dumps({
    "file": rom.name, "bytes": len(data), "sha256": digest,
    "crc32": f"{zlib.crc32(data):08x}",
    "title": data[0x7FC0:0x7FD5].decode("ascii").rstrip(),
    "mapping_byte": f"0x{data[0x7FD5]:02x}",
    "mapping": "Fast LoROM", "cartridge_type": data[0x7FD6],
    "region_byte": data[0x7FD9], "region": "Europe / PAL",
    "declared_rom_bytes": 1024 << data[0x7FD7],
    "declared_sram_bytes": 0 if not data[0x7FD8] else 1024 << data[0x7FD8],
    "checksum": f"{word(0x7FDE):04x}",
    "checksum_complement_valid": word(0x7FDC) ^ word(0x7FDE) == 0xFFFF,
    "byte_sum_matches_checksum": sum(data) & 0xFFFF == word(0x7FDE),
    "vectors": vectors,
    "translated_reset_prefix": {
        "cpu_start": "00:8000", "cpu_end_exclusive": "00:8028",
        "file_start": 0, "file_end_exclusive": 40,
        "bytes_hex": data[:40].hex(" "),
    },
    "limits": "Header and reset-prefix inspection only; no gameplay or timing validation.",
}, indent=2))
