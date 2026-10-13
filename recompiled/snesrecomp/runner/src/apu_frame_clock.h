#pragma once
#include <stdint.h>

#define RTL_MASTER_CYCLES_PER_FRAME 425568ull
#define RTL_APU_CYCLES_PER_FRAME 20502ull /* PAL nominal field, fractional clock below */

/* A host iteration can include an NMI-disabled loader spanning many hardware
 * frames. Keep its elapsed time when beginning the following iteration. */
typedef struct RtlApuFrameClock {
  uint64_t start_master, start_guest, next_guest, last_duration;
} RtlApuFrameClock;

static inline void rtl_apu_clock_begin(RtlApuFrameClock *clock, uint64_t master) {
  clock->start_master = master;
  clock->start_guest = clock->next_guest;
}

static inline uint64_t rtl_apu_clock_now(const RtlApuFrameClock *clock,
                                        uint64_t master) {
  /* RESET may initialize CPU state inside the first host iteration. */
  uint64_t within = master >= clock->start_master ? master - clock->start_master : 0;
  return clock->start_guest + within * 1025280ull / 21281370ull;
}

static inline uint64_t rtl_apu_clock_finish(RtlApuFrameClock *clock,
                                           uint64_t master) {
  uint64_t end = rtl_apu_clock_now(clock, master);
  uint64_t minimum = clock->start_guest + RTL_APU_CYCLES_PER_FRAME;
  if (end < minimum) end = minimum;  /* WAI still advances a hardware frame. */
  clock->last_duration = end - clock->start_guest;
  clock->next_guest = end;
  /* Leave the current origin intact: raster IRQs can still touch APU ports
   * between the completed game iteration and the next clock_begin. */
  return end;
}
