#ifndef SMASH_RESET_PREFIX_H
#define SMASH_RESET_PREFIX_H
#include <stdint.h>

typedef struct {
    uint16_t a, x, y, s, d, pc;
    uint8_t p, pbr, dbr, e;
} SmashCpu;

typedef struct {
    void *context;
    uint8_t (*read8)(void *, uint32_t);
    void (*write8)(void *, uint32_t, uint8_t);
} SmashBus;

/* Translation of only ROM offsets [0,40). Requires hardware-reset CPU state
 * (E=1, PBR=0, PC=0x8000, S in page 1). No cycle scheduling is implemented.
 * Stops BEFORE the first indexed ROM read at 00:8028. This is not a game. */
void smash_reset_prefix(SmashCpu *cpu, const SmashBus *bus);
#endif
