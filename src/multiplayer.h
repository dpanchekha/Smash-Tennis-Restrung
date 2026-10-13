#pragma once
#include <stdint.h>
enum { MP_OFF, MP_MENU, MP_NAME, MP_CHARACTER, MP_CODE, MP_JOIN,
       MP_LOADING, MP_READY, MP_PLAY, MP_ERROR, MP_ENDED };
void mp_init(void);
int mp_input(uint32_t *buttons);
void mp_after_frame(void);
void mp_draw(uint32_t *pixels);
int smash_ui_state(void);
void smash_text_key(int key);
const char *smash_username(void);
const char *smash_lobby_code(void);
int smash_character(void);
void smash_net_status(int status);
int smash_prepare_match(int first, int second);
int smash_start_match(void);
int smash_receive_frame(int frame, uint32_t buttons);
int smash_net_tick(void);
uint32_t smash_state_hash(void);
int smash_capture_menu(void);
const void *smash_menu_snapshot(void);
int smash_apply_menu(const void *data, int size);
