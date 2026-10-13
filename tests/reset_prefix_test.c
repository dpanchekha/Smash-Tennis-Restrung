#include "reset_prefix.h"
#include <assert.h>
#include <stdio.h>

static uint8_t memory[65536];
static unsigned writes;
static const uint32_t addresses[] = {
    0x1ff, 0x1ff, 0x1fe, 0x420d, 0x4200, 0x2100, 0x96
};
static const uint8_t values[] = {0, 0, 0, 1, 1, 0x8f, 0x8f};
static uint8_t read8(void *ctx, uint32_t address) {
    (void)ctx;
    assert(address < sizeof memory);
    return memory[address];
}
static void write8(void *ctx, uint32_t address, uint8_t value) {
    (void)ctx;
    assert(writes < sizeof values);
    assert(address == addresses[writes] && value == values[writes]);
    ++writes;
    memory[address] = value;
}
int main(void) {
    SmashCpu c = {.a = 0xab00, .s = 0x1ff, .pc = 0x8000,
                  .p = 0x34, .e = 1};
    SmashBus b = {.read8 = read8, .write8 = write8};
    smash_reset_prefix(&c, &b);
    assert(writes == sizeof values);
    assert(c.a == 0xab8f && c.x == 14 && c.y == 0);
    assert(c.s == 0x1fff && c.d == 0 && c.pc == 0x8028);
    assert(c.p == 0x27 && c.e == 0 && c.dbr == 0 && c.pbr == 0);
    puts("Reset prefix: register and bus-write checks passed (not a timing test).");
}
