#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <time.h>
#include "common_cpu_infra.h"
#include "common_rtl.h"
#include "cpu_state.h"
#include "beam_frame_driver.h"
#include "snes/ppu.h"
#include "snes/snes.h"
#include "snes/interp_bridge.h"
#include "multiplayer.h"
#include "rollback.h"

static uint32_t pixels[512 * 240];
static int16_t audio_samples[4096 * 2];
void smash_test_interpreter(int enabled) {
    interp_bridge_set_scheduler_aot_policy(enabled ? 0 : 1);
}
uint32_t smash_stack(void) { return g_cpu.S; }
static void save_execution(struct SaveLoadInfo *sli) {
    RtlSaveExecutionState(sli);
    snes_beam_frame_driver_saveload(sli);
}
static void load_execution(struct SaveLoadInfo *sli, uint32_t version) {
    (void)version;
    if (!RtlLoadExecutionState(sli)) { RtlStateStreamFail(sli); return; }
    snes_beam_frame_driver_saveload(sli);
}
static void apply_execution(uint32_t version) {
    (void)version;
    RtlApplyExecutionState();
}
void smash_diagnostics(void) {
    fprintf(stderr, "frame=%d pc=%06x S=%04x P=%02x mode=%d blank=%02x nmi=%d beam=%d:%d\n",
      snes_frame_counter, interp_bridge_lle_resume_pc(), g_cpu.S, g_cpu.P,
      g_ppu->bgmode, g_ppu->inidisp, g_snes->nmiEnabled, g_snes->vPos, g_snes->hPos);
}
static const RtlGameInfo game = {
    .title = "Smash Tennis", .run_frame = snes_beam_frame_driver_run_frame,
    .draw_ppu_frame = snes_beam_frame_driver_draw_ppu_frame,
    .save_name_prefix = "smash", .session_reset = snes_beam_frame_driver_reset,
    .state_save_extra = save_execution, .state_load_extra = load_execution,
    .on_state_loaded = apply_execution
};

/* All guest execution and audio consumption occur on the browser main thread. */
void RtlApuLock(void) {}
void RtlApuUnlock(void) {}
void host_report_breadcrumb(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap);
    fputc('\n', stderr);
}
void host_report_fatal(const char *msg) { fprintf(stderr, "Fatal: %s\n", msg); }

int smash_init(const uint8_t *rom, int size, int audio_rate) {
    /* The AOT task dispatcher loses seven guest stack bytes per menu frame
     * through its dynamic $82:BC24 tail. Interpret that boundary while its
     * children remain eligible for C dispatch. Preserve their analysis roots. */
    setenv("SNESRECOMP_LLE_INTERP_TARGET", "808895", 1);
    RtlRegisterGame(&game);
    if (!SnesInit(rom, size)) return 0;
    snes_beam_frame_driver_reset();
    RtlSetAudioOutputRate(audio_rate);
    RtlEnableExtendedFrameTiming();
    mp_init();
    return 1;
}
uint32_t *smash_pixels(void) { return pixels; }
int16_t *smash_audio_buffer(void) { return audio_samples; }
static void expand_low_resolution(const Ppu *ppu, unsigned line, void *context) {
    (void)context;
    if (PPU_mode(ppu) == 5 || PPU_mode(ppu) == 6 || PPU_pseudoHires(ppu)) return;
    uint32_t *row = pixels + (line - 1) * 512;
    for (int x = 255; x >= 0; --x) row[x * 2] = row[x * 2 + 1] = row[x];
}
int smash_run_guest(uint32_t buttons,int draw) {
    PpuBeginDrawing(g_ppu, draw?(uint8_t *)pixels:NULL, 512 * 4, kPpuRenderFlags_NewRenderer);
    RtlRunFrame(buttons);
    snes_beam_frame_driver_draw_ppu_frame_observed(draw?expand_low_resolution:NULL, NULL);
    return !g_watchdog_tripped;
}
int smash_frame(uint32_t buttons) {
    if(smash_ui_state()==MP_PLAY && rb_active()) return rb_step();
    if (!mp_input(&buttons)) { mp_draw(pixels); return 2; }
    if(!smash_run_guest(buttons,1)) return 0;
    mp_after_frame();
    mp_draw(pixels);
    return !g_watchdog_tripped;
}
void smash_audio(int frames) {
    if (frames > 0 && frames <= 4096) RtlRenderAudio(audio_samples, frames, 2);
}

#ifndef __EMSCRIPTEN__
int main(int argc, char **argv) {
    if (argc < 2) return 2;
    FILE *f = fopen(argv[1], "rb");
    if (!f) return 2;
    fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
    if (size != 1048576) return 2;
    uint8_t *rom = malloc((size_t)size);
    if (!rom || fread(rom, 1, (size_t)size, f) != (size_t)size) return 2;
    fclose(f);
    if (!smash_init(rom, (int)size, 32040)) return 3;
    free(rom);
    int frames = argc > 2 ? atoi(argv[2]) : 600;
    for (int i = 0; i < frames; ++i) {
        if (!smash_frame(0)) { fprintf(stderr, "Watchdog at %d\n", i); return 4; }
        smash_audio(640);
    }
    f = fopen("build/frame.ppm", "wb");
    if (!f) return 2;
    fprintf(f, "P6\n512 224\n255\n");
    for (int i = 0; i < 512 * 224; ++i) {
        uint32_t p = pixels[i];
        uint8_t rgb[3] = {p >> 16, p >> 8, p};
        fwrite(rgb, 1, 3, f);
    }
    fclose(f);
    printf("Ran %d frames; screenshot: build/frame.ppm\n", frames);
    return 0;
}
#endif
