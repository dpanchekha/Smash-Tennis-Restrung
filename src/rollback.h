#pragma once
#include <stdint.h>
enum { RB_DELAY=2, RB_WINDOW=6 };
void rb_reset(void);
int rb_active(void);
int rb_step(void);
int rb_receive(int frame,uint32_t buttons);
int smash_start_rollback(int seat);
int smash_local_input(int frame,uint32_t buttons);
int smash_rollback_tick(void);
int smash_confirmed_tick(void);
uint32_t smash_confirmed_hash(int frame);
int smash_rollback_count(void);
int smash_replayed_frames(void);
int smash_rollback_stalls(void);
/* Host runs all hardware clocks; draw=0 omits only pixel composition. */
int smash_run_guest(uint32_t buttons,int draw);
void mp_end_match(void);
