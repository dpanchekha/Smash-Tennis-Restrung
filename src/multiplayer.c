/* Game-owned menu and online exhibition state machine. The browser transports
 * text events and numbered input pairs; it owns no menu or match rules.
 * WRAM $00=0/$02=$18/$04=$02 identifies the original active mode menu. The original
 * selection at $10/$52 is 0=exhibition, 1=tournament, 2=options. */
#include "multiplayer.h"
#include "rollback.h"
#include "common_rtl.h"
#include "snes_overlay_draw.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static int state, selection, character, keyboard, departing, age;
static uint32_t previous;
static uint32_t backdrop[512*224];
static int capture_backdrop, chosen[2];
static char username[21], code[49];
static const char *notice;
static const char *characters[] = {"MIKE","DAN","JOHN","DARREN","MATT","MARK",
    "PETER","PAUL","IAN","TONY","BRIAN","STEVE","HELEN","SUSAN","JULIE",
    "ROSE","CAROL","MARINA","KIRSTY","NINA"};
static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.";
static struct { int frames; uint32_t buttons; } script[128];
static int script_count, script_index, script_left;
static int tick, received;
static uint32_t inputs[128];
static void *menu_snapshot;
static size_t menu_size, menu_capacity;
static int borrowed_menu;
static uint16_t word(int offset) { return g_ram[offset] | g_ram[offset+1] << 8; }
static void put_word(int offset, int value) { g_ram[offset]=value; g_ram[offset+1]=value>>8; }
static int mode_menu(void) { return word(0)==0 && word(2)==0x18 && word(4)==2; }
void mp_init(void) {
    rb_reset();
    state=MP_OFF; selection=character=keyboard=departing=age=0; previous=0;
    username[0]=code[0]=0; notice=""; tick=received=0;
    capture_backdrop=0;
    free(menu_snapshot); menu_snapshot=NULL; menu_size=menu_capacity=0; borrowed_menu=0;
}
/* Portable runtime snapshot, including CPU timing and the beam driver's
 * continuation. No second core, console reset, or boot replay is involved. */
int smash_capture_menu(void) {
    if(!mode_menu() || borrowed_menu) return 0;
    if(!menu_snapshot) {
        menu_capacity=RtlRollbackSnapshotBound();
        if(!menu_capacity || menu_capacity>2097152) return 0;
        menu_snapshot=malloc(menu_capacity);
        if(!menu_snapshot) return 0;
    }
    menu_size=RtlSaveSnapshotToMemory(menu_snapshot,menu_capacity);
    return (int)menu_size;
}
const void *smash_menu_snapshot(void) { return menu_snapshot; }
int smash_apply_menu(const void *data,int size) {
    if(size<=0 || size>2097152 || !smash_capture_menu()) return 0;
    borrowed_menu=1;
    if(!RtlLoadSnapshotFromMemory(data,(size_t)size) || !mode_menu()) {
        RtlLoadSnapshotFromMemory(menu_snapshot,menu_size); borrowed_menu=0; return 0;
    }
    return 1;
}
int smash_ui_state(void) { return state; }
const char *smash_username(void) { return username; }
const char *smash_lobby_code(void) { return code; }
int smash_character(void) { return character; }
int smash_net_tick(void) { return rb_active()?smash_rollback_tick():tick; }
uint32_t smash_state_hash(void) {
    uint32_t hash=2166136261u;
    for (int i=0;i<0x20000;i++) hash=(hash^g_ram[i])*16777619u;
    return hash;
}
static void accept_text(void) {
    char *s=state==MP_NAME?username:code;
    size_t n=strlen(s);
    while(n && s[n-1]==' ') s[--n]=0;
    while(*s==' ') memmove(s,s+1,strlen(s));
    if (!*s) { notice="PLEASE ENTER SOME TEXT"; return; }
    state=state==MP_NAME?MP_CHARACTER:MP_JOIN;
    notice="CONNECTING TO LOBBY..."; keyboard=0;
}
void smash_text_key(int key) {
    if (state!=MP_NAME && state!=MP_CODE) return;
    char *s=state==MP_NAME?username:code;
    size_t n=strlen(s), limit=state==MP_NAME?20:48;
    if(key==8) { if(n) s[n-1]=0; }
    else if(key==13) accept_text();
    else if(key>=32 && key<=126 && n<limit) {
        if(key>='a' && key<='z') key-=32;
        s[n]=(char)key; s[n+1]=0;
    }
}
void smash_net_status(int status) {
    if(status<0) rb_reset();
    if(status<0 && borrowed_menu) {
        if(!RtlLoadSnapshotFromMemory(menu_snapshot,menu_size)) {
            state=MP_ERROR; notice="COULD NOT RESTORE MENU - RELOAD"; return;
        }
        borrowed_menu=0;
    }
    if (status<0) { state=MP_ERROR; notice=status==-2?"LOBBY FULL - MAXIMUM TWO PLAYERS":
        status==-3?"GAME VERSIONS OR STATES DO NOT MATCH":
        status==-4?"CONNECTION LOST - MATCH STOPPED":
        status==-5?"EXHIBITION ENDED - RETURN TO MENU":"LOBBY CONNECTION FAILED"; }
    else if(state==MP_JOIN) notice=status==1?"WAITING FOR OPPONENT (1/2)":"BOTH PLAYERS JOINED - LOADING...";
}
static void segment(int frames,uint32_t buttons) {
    script[script_count].frames=frames; script[script_count++].buttons=buttons;
}
static void press(uint32_t buttons,int wait) { segment(2,buttons); segment(wait,0); }
/* Continue from the shared current menu, inside the existing instance. */
int smash_prepare_match(int first,int second) {
    if(first<0 || first>=20 || second<0 || second>=20 || !borrowed_menu || !mode_menu()) return 0;
    state=MP_LOADING; tick=received=0; script_count=script_index=0;
    chosen[0]=first; chosen[1]=second;
    put_word(0x10,0); put_word(0x52,0);
    segment(2,0); press(8,300);
    press(32,60); /* Original GAME SELECT: 1P vs 2P (singles exhibition). */
    press(8,180);
    for(int player=0;player<2;player++) {
        int choice=player?second:first, shift=player*12;
        for(int row=0;row<choice/2;row++) press(32u<<shift,20);
        if(choice%2) press(128u<<shift,20);
        press(8u<<shift,180);
    }
    press(8,180); press(8,500);
    script_left=script[0].frames;
    return 1;
}
int smash_start_match(void) {
    if(state!=MP_READY) return 0;
    state=MP_PLAY; previous=0; return 1;
}
int smash_receive_frame(int frame,uint32_t buttons) {
    if(state==MP_PLAY && rb_active()) return rb_receive(frame,buttons);
    if(state!=MP_PLAY || frame!=received || received-tick>=128 || buttons>0xffffff) return 0;
    inputs[received++%128]=buttons; return 1;
}
void mp_end_match(void) { state=MP_ENDED;notice="EXHIBITION ENDED"; }
int mp_input(uint32_t *buttons) {
    uint32_t edge=(*buttons & 0xfff)&~previous; previous=*buttons & 0xfff;
    uint32_t menu_buttons=0;
    if(state==MP_LOADING) { *buttons=script[script_index].buttons; return 1; }
    if(state==MP_PLAY) {
        if(tick==received) return 0;
        *buttons=inputs[tick++%128]; return 1;
    }
    if(state==MP_READY || state==MP_ENDED) return 0;
    if(state==MP_OFF) {
        if(departing) {
            if(!mode_menu()) departing=0;
            else { *buttons=departing++==1?0:8; return 1; }
        }
        if(mode_menu()) { state=MP_MENU; selection=word(0x10); capture_backdrop=1; }
        else return 1;
    }
    age++;
    if(state==MP_MENU) {
        /* Let the original menu process each directional edge so its own
         * sound driver plays the navigation effect. Our four-item selection
         * remains independent of the original three-item cursor. */
        menu_buttons=edge&(16|32);
        if(edge&16) selection=(selection+3)%4;
        if(edge&32) selection=(selection+1)%4;
        if(edge&(8|256|1)) {
            if(selection==2) { state=MP_NAME; notice=""; menu_buttons=32; }
            else {
                put_word(0x10,selection==3?2:selection); put_word(0x52,selection==3?2:selection);
                state=MP_OFF; departing=1; *buttons=0; return 1;
            }
        }
    } else if(state==MP_NAME || state==MP_CODE) {
        if(edge&16) keyboard=(keyboard+32)%40;
        if(edge&32) keyboard=(keyboard+8)%40;
        if(edge&64) keyboard=(keyboard+39)%40;
        if(edge&128) keyboard=(keyboard+1)%40;
        if(edge&256) { if(keyboard==39) smash_text_key(8); else smash_text_key(alphabet[keyboard]); }
        if(edge&1) smash_text_key(8);
        if(edge&8) accept_text();
        if(edge&4) { state=state==MP_NAME?MP_MENU:MP_CHARACTER; notice=""; }
    } else if(state==MP_CHARACTER) {
        if(edge&16) character=(character+18)%20;
        if(edge&32) character=(character+2)%20;
        if(edge&(64|128)) character^=1;
        if(edge&(8|256)) { state=MP_CODE; keyboard=0; notice=""; }
        if(edge&(1|4)) state=MP_NAME;
    } else if(state==MP_JOIN || state==MP_ERROR) {
        if(edge&(1|4|8)) { state=MP_MENU; notice=""; }
    }
    /* Keep the native menu/audio clock alive beneath the overlay. In
     * particular, don't cut a navigation sound off on the following frame.
     * Never pass confirmation through to the original three-item menu. */
    if(state>=MP_MENU && state<=MP_JOIN && mode_menu()) {
        *buttons=menu_buttons; return 1;
    }
    return 0;
}
void mp_after_frame(void) {
    /* $00 is the top-level dispatcher (808895); $02 is a substate and changes
     * during the court intro and play. $00=0 is title/mode menu, $00=2 is match
     * setup. Stop before online input can choose a different game mode. */
    if(state==MP_PLAY && (word(0)==0 || word(0)==2)) {
        state=MP_ENDED;notice="EXHIBITION ENDED";return;
    }
    if(state!=MP_LOADING) return;
    if(--script_left>0) return;
    if(++script_index<script_count) { script_left=script[script_index].frames; return; }
    /* Confirm the engine has left setup and loaded precisely two real players. */
    if(word(2)!=4 || word(0x1074)!=0x806b+55*chosen[0] ||
       word(0x1174)!=0x806b+55*chosen[1]) {
        state=MP_ERROR; notice="MATCH SETUP FAILED"; return;
    }
    state=MP_READY;
}
static uint32_t *screen;
static void box(int x,int y,int w,int h,uint32_t color) { snes_ovl_fill_rect(screen,512,224,x,y,w,h,color); }
static void text(int x,int y,const char *s,uint32_t color) {
    /* Shared runner font ends at Z. Complete printable punctuation used by
     * typed lobby codes here (letters are normalized to uppercase at entry). */
    static const unsigned char extra[10][8]={
        {30,6,6,6,6,6,30,0}, {3,6,12,24,48,96,64,0},
        {30,24,24,24,24,24,30,0}, {8,20,34,0,0,0,0,0},
        {0,0,0,0,0,0,127,0}, {6,12,0,0,0,0,0,0},
        {24,12,12,6,12,12,24,0}, {8,8,8,8,8,8,8,0},
        {6,12,12,24,12,12,6,0}, {0,0,38,89,0,0,0,0}};
    for(;*s;s++,x+=8) {
        unsigned char c=(unsigned char)*s;
        int index=(c>=91 && c<=96)?c-91:(c>=123 && c<=126)?c-117:-1;
        if(index<0) snes_ovl_draw_char(screen,512,224,x,y,*s,color,1);
        else for(int row=0;row<8;row++) for(int col=0;col<7;col++)
            if(extra[index][row]&(1<<col)) box(x+col,y+row,1,1,color);
    }
}
/* Title-menu lettering follows the original 256-pixel artwork: tall serif
 * initials with small lowercase letters. The framebuffer doubles X only.
 * Keep this separate from the existing multiplayer screen font. */
static void title_text(int x,int y,const char *s,uint32_t color) {
    static const struct { char letter; int width; uint16_t rows[17]; } glyphs[]={
        {'E',11,{0x7ff,0x606,0x406,0x406,0x86,0x86,0xc6,0xfe,0xc6,0x86,0x86,0x406,0x406,0x606,0x7ff}},
        {'T',14,{0x1002,0x1ffe,0x30c3,0x20c1,0x20c1,0xc0,0xc0,0xc0,0xc0,0xc0,0xc0,0xc0,0xc0,0x1e0,0x3f0}},
        {'M',15,{0x7007,0x3006,0x380e,0x380e,0x3416,0x3416,0x3226,0x3226,0x3146,0x3146,0x3086,0x3086,0x3006,0x3006,0x780f}},
        {'O',13,{0x1f0,0x71c,0xc06,0xc06,0x1803,0x1803,0x1803,0x1803,0x1803,0x1803,0x1803,0xc06,0xc06,0x71c,0x1f0}},
        {'x',5,{0,0,0,0,0,0,0,0,0x11,0xa,0xa,4,0xa,0xa,0x11}},
        {'h',5,{0,1,1,1,1,1,1,1,0xd,0x13,0x11,0x11,0x11,0x11,0x11}},
        {'i',1,{0,0,0,0,0,1,0,0,1,1,1,1,1,1,1}},
        {'b',5,{0,1,1,1,1,1,1,1,0xd,0x13,0x11,0x11,0x11,0x13,0xd}},
        {'t',4,{0,0,0,0,0,2,2,2,0xf,2,2,2,2,2,4}},
        {'o',5,{0,0,0,0,0,0,0,0,0xe,0x11,0x11,0x11,0x11,0x11,0xe}},
        {'n',5,{0,0,0,0,0,0,0,0,0xd,0x13,0x11,0x11,0x11,0x11,0x11}},
        {'u',5,{0,0,0,0,0,0,0,0,0x11,0x11,0x11,0x11,0x11,0x19,0x16}},
        {'r',4,{0,0,0,0,0,0,0,0,0xd,3,1,1,1,1,1}},
        {'a',5,{0,0,0,0,0,0,0,0,0xe,0x10,0x10,0x1e,0x11,0x11,0x1e}},
        {'m',7,{0,0,0,0,0,0,0,0,0x6d,0x5b,0x49,0x49,0x49,0x49,0x49}},
        {'e',5,{0,0,0,0,0,0,0,0,0xe,0x11,0x11,0x1f,1,1,0xe}},
        {'p',6,{0,0,0,0,0,0,0,0,0x1d,0x23,0x21,0x21,0x23,0x1d,1,1}},
        {'l',2,{0,1,1,1,1,1,1,1,1,1,1,1,1,1,2}},
        {'y',5,{0,0,0,0,0,0,0,0,0x11,0x11,0x11,0x12,0x12,0xc,4,2,1}}
    };
    for(;*s;s++) for(size_t i=0;i<sizeof(glyphs)/sizeof(glyphs[0]);i++) {
        if(glyphs[i].letter!=*s) continue;
        for(int row=0;row<17;row++) for(int col=0;col<glyphs[i].width;col++)
            if(glyphs[i].rows[row]&(1u<<col)) box(x+col*2,y+row,2,1,color);
        x+=(glyphs[i].width+2)*2;
        break;
    }
}
static void title_menu(void) {
    /* Erase only the old pale lettering, retaining the original darkened
     * court, stadium, panel borders, and logo. Never alter the saved backdrop:
     * subsequent multiplayer screens still receive exactly the same image. */
    for(int y=134;y<201;y++) for(int x=146;x<298;x++) {
        uint32_t c=backdrop[y*512+x];
        if(((c>>16)&255)>180 && ((c>>8)&255)>180 && (c&255)>180)
            screen[y*512+x]=backdrop[y*512+320];
    }
    const char *items[]={"Exhibition","Tournament","Multiplayer","Option"};
    int top=132+selection*17;
    /* A restrained blue-green selection band within the original panel. */
    for(int y=top;y<top+17;y++) for(int x=84;x<430;x++) {
        uint32_t c=screen[y*512+x];
        unsigned r=((c>>16)&255),g=((c>>8)&255),b=c&255;
        screen[y*512+x]=((r*3+32)/4<<16)|((g*3+112)/4<<8)|((b*3+112)/4);
    }
    box(84,top,346,1,0x8c9452); box(84,top+16,346,1,0x8c9452);
    for(int i=0;i<4;i++) title_text(148,133+i*17,items[i],i==selection?0xffffde:0xefefef);
}
void mp_draw(uint32_t *pixels) {
    screen=pixels;
    if(state==MP_OFF || state==MP_PLAY) return;
    if(capture_backdrop) { memcpy(backdrop,pixels,sizeof(backdrop)); capture_backdrop=0; }
    if(state!=MP_LOADING && state!=MP_READY) memcpy(pixels,backdrop,sizeof(backdrop));
    const uint32_t white=0xffffff, gold=0xffdf70, green=0x174038;
    if(state==MP_MENU) {
        title_menu();
        return;
    }
    box(16,8,480,208,0x101e34); box(16,8,480,16,green);
    text(168,12,"MULTIPLAYER - SINGLES",gold);
    if(state==MP_NAME || state==MP_CODE) {
        text(40,35,state==MP_NAME?"ENTER YOUR ONLINE USERNAME":"ENTER A SHARED LOBBY CODE",white);
        text(40,50,state==MP_NAME?username:code,gold);
        for(int i=0;i<40;i++) {
            int x=48+(i%8)*52,y=73+(i/8)*20;
            char s[4]={alphabet[i],0}; if(i==39) strcpy(s,"DEL");
            if(i==keyboard) box(x-4,y-4,42,18,0x24746c);
            text(x,y,s,white);
        }
        text(32,181,"TYPE OR D-PAD + A. START/ENTER: CONTINUE",white);
        text(32,194,"B: DELETE  SELECT: BACK",gold);
        if(*notice) text(32,205,notice,gold);
    } else if(state==MP_CHARACTER) {
        text(144,32,"CHOOSE YOUR CHARACTER",white);
        for(int i=0;i<20;i++) {
            int x=88+(i%2)*200,y=50+(i/2)*14;
            if(i==character) box(x-12,y-2,160,13,0x24746c);
            text(x,y,characters[i],i==character?gold:white);
        }
        text(48,201,"D-PAD: CHOOSE  A/START: OK  B: BACK",white);
    } else {
        text(48,65,state==MP_LOADING?"LOADING 1P VS 2P EXHIBITION...":
            state==MP_READY?"LOADED - WAITING FOR OTHER PLAYER":notice,white);
        if(state==MP_JOIN) { text(48,90,"LOBBY CODE:",gold); text(48,106,code,white); }
        if(state==MP_JOIN || state==MP_ERROR) text(48,192,"B/START: RETURN TO MENU",gold);
        if(state==MP_LOADING) { box(48,110,400,8,green); box(48,110,400*script_index/script_count,8,gold); }
    }
}
