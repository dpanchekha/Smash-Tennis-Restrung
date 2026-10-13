"""Analysis-only linear 65816 listing; specify known instruction boundaries.

Usage: python3 tools/disassemble_stats.py 81A0D8 81A200 [M=0] [X=0]
Tracks REP/SEP only. Calls, PLP and control-flow merges require manual width
validation; this is not a control-flow disassembler.
"""
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path.home() / 'snesrecomp' / 'recompiler'))
import snes65816 as decoder

rom = Path('Smash Tennis (axekin.com).sfc').read_bytes()
pc, end = (int(s, 16) for s in sys.argv[1:3])
m, x = (list(map(int, sys.argv[3:5])) + [0, 0])[:2]
while pc < end:
    offset = ((pc >> 16) & 0x7f) * 0x8000 + (pc & 0x7fff)
    insn = decoder.decode_insn(rom, offset, pc & 0xffff, pc >> 16, m, x)
    if insn is None:
        raise ValueError(hex(pc))
    raw = rom[offset:offset + insn.length].hex(' ')
    print(f'{pc:06X}  {raw:11} {insn.mnem:3} {decoder.MODE_STR[insn.mode]:8} ${insn.operand:06X}')
    if insn.mnem == 'REP':
        if insn.operand & 0x20: m = 0
        if insn.operand & 0x10: x = 0
    if insn.mnem == 'SEP':
        if insn.operand & 0x20: m = 1
        if insn.operand & 0x10: x = 1
    pc += insn.length
