#include "reset_prefix.h"
#include <assert.h>

enum { C = 1, Z = 2, I = 4, X = 16, M = 32, N = 128 };

static void nz(SmashCpu *c, uint16_t value, unsigned sign) {
    c->p = (uint8_t)((c->p & ~(N | Z)) |
                    (value == 0 ? Z : 0) | (value & sign ? N : 0));
}
static void push(SmashCpu *c, const SmashBus *b, uint8_t v) {
    b->write8(b->context, c->s, v);
    --c->s; /* All pushes in this prefix occur after entering native mode. */
}
static uint8_t pull(SmashCpu *c, const SmashBus *b) {
    return b->read8(b->context, ++c->s);
}
static void load_a8(SmashCpu *c, uint8_t v) {
    c->a = (uint16_t)((c->a & 0xff00) | v);
    nz(c, v, 0x80);
}

void smash_reset_prefix(SmashCpu *c, const SmashBus *b) {
    assert(c->e == 1 && c->pbr == 0 && c->pc == 0x8000);
    assert((c->s & 0xff00) == 0x100);
    /* 8000 CLC; 8001 XCE: exchange cleared carry with reset E=1. */
    c->e = 0;
    c->p |= C;
    c->p |= M;                 /* 8002 SEP #$20 */
    c->p &= (uint8_t)~X;       /* 8004 REP #$10 */
    push(c, b, c->pbr);        /* 8006 PHK */
    c->dbr = pull(c, b);       /* 8007 PLB */
    nz(c, c->dbr, 0x80);
    push(c, b, 0);             /* 8008 PEA $0000, high then low */
    push(c, b, 0);
    c->d = pull(c, b);         /* 800B PLD, low then high */
    c->d |= (uint16_t)((uint16_t)pull(c, b) << 8);
    nz(c, c->d, 0x8000);
    load_a8(c, 1);             /* 800C LDA #$01 */
    b->write8(b->context, 0x420d, 1); /* 800E STA MEMSEL */
    c->p |= I;                /* 8011 SEI */
    load_a8(c, 1);             /* 8012 LDA #$01 */
    b->write8(b->context, 0x4200, 1); /* 8014 STA NMITIMEN */
    load_a8(c, 0x8f);          /* 8017 LDA #$8F */
    b->write8(b->context, 0x2100, 0x8f); /* 8019 STA INIDISP */
    b->write8(b->context, 0x96, 0x8f);   /* 801C STA $96 */
    c->x = 0x1fff;            /* 801E LDX #$1FFF */
    nz(c, c->x, 0x8000);
    c->s = c->x;              /* 8021 TXS */
    c->x = 14;                /* 8022 LDX #$000E */
    nz(c, c->x, 0x8000);
    c->y = 0;                 /* 8025 LDY #$0000 */
    nz(c, c->y, 0x8000);
    c->pc = 0x8028;
}
