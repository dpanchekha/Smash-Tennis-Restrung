/* Two-frame local delay, six-frame prediction, bounded in-process history.
 * Authoritative paired inputs still come from the lobby relay, but rendering
 * no longer waits for them. Only corrected, confirmed states are hashed. */
#include "rollback.h"
#include "multiplayer.h"
#include "common_rtl.h"
#include <stdlib.h>
#include <string.h>

enum { HISTORY=64, SNAPSHOTS=RB_WINDOW+2, REPLAY_BUDGET=2 };
static struct {
    int local_tag,actual_tag,used_tag;
    uint32_t local,actual,used,hash;
    int ended;
} history[HISTORY];
static struct { void *data; size_t size; int tag; } snapshots[SNAPSHOTS];
static size_t capacity;
static int active,seat,head,received,local_next,confirmed,dirty,replay;
static int corrections,replayed,stalls;

void rb_reset(void) {
    for(int i=0;i<SNAPSHOTS;i++) {free(snapshots[i].data);snapshots[i].data=NULL;}
    active=0;head=received=local_next=confirmed=0;dirty=replay=-1;
    corrections=replayed=stalls=0;
}
int rb_active(void) { return active; }
int smash_rollback_tick(void) { return head; }
int smash_confirmed_tick(void) { return confirmed; }
int smash_rollback_count(void) { return corrections; }
int smash_replayed_frames(void) { return replayed; }
int smash_rollback_stalls(void) { return stalls; }
uint32_t smash_confirmed_hash(int frame) {
    if(frame<=0 || frame>confirmed || head-frame>=HISTORY) return 0;
    int i=(frame-1)%HISTORY;
    return history[i].used_tag==frame-1?history[i].hash:0;
}
int smash_start_rollback(int player) {
    if(player<0 || player>1 || smash_ui_state()!=MP_READY) return 0;
    rb_reset();seat=player;capacity=RtlRollbackSnapshotBound();
    if(!capacity || capacity>2097152) return 0;
    memset(history,0,sizeof(history));
    for(int i=0;i<HISTORY;i++) history[i].local_tag=history[i].actual_tag=history[i].used_tag=-1;
    for(int i=0;i<SNAPSHOTS;i++) {
        snapshots[i].tag=-1;snapshots[i].data=malloc(capacity);
        if(!snapshots[i].data) {rb_reset();return 0;}
    }
    if(!smash_start_match()) {rb_reset();return 0;}
    active=1;return 1;
}
int smash_local_input(int frame,uint32_t buttons) {
    if(!active || frame!=local_next || frame>head+RB_DELAY || buttons>4095) return 0;
    int i=frame%HISTORY;
    history[i].local_tag=frame;history[i].local=buttons;local_next++;
    return 1;
}
static void publish(void) {
    if(dirty>=0 || replay>=0) return;
    int limit=received<head?received:head;
    while(confirmed<limit) {
        int i=confirmed%HISTORY;
        confirmed++;
        if(history[i].ended) {mp_end_match();break;}
    }
}
int rb_receive(int frame,uint32_t buttons) {
    if(!active || frame!=received || frame>head+RB_DELAY || buttons>0xffffff) return 0;
    int i=frame%HISTORY;
    if(history[i].local_tag!=frame || ((buttons>>(seat*12))&4095)!=history[i].local) return 0;
    history[i].actual_tag=frame;history[i].actual=buttons;received++;
    /* Inputs for the not-yet-replayed suffix will be used naturally. Loading
     * its OLD snapshot would throw away the corrected prefix from the last
     * callback. Only rewind again if already replayed work became invalid. */
    if(frame<head && (replay<0 || frame<replay) && history[i].used_tag==frame && history[i].used!=buttons)
        if(dirty<0 || frame<dirty) dirty=frame;
    publish();return 1;
}
static int simulate(int frame,int draw) {
    int i=frame%HISTORY,s=frame%SNAPSHOTS;
    if(history[i].local_tag!=frame) return 0;
    snapshots[s].size=RtlRollbackSaveToMemory(snapshots[s].data,capacity);
    if(!snapshots[s].size) return 0;
    snapshots[s].tag=frame;
    uint32_t input;
    if(history[i].actual_tag==frame) input=history[i].actual;
    else {
        uint32_t remote=received?history[(received-1)%HISTORY].actual:0;
        uint32_t mask=4095u<<(seat*12);
        input=(remote&~mask)|(history[i].local<<(seat*12));
    }
    history[i].used_tag=frame;history[i].used=input;
    /* Re-run the APU too: it participates in CPU handshakes. Only throw away
     * newly generated PCM, never the live consumer's queued sound. */
    uint32_t audio=RtlAudioProducerCursor();
    int ok=smash_run_guest(input,draw);
    if(!draw) RtlAudioRewindProducer(audio);
    history[i].hash=smash_state_hash();
    int mode=g_ram[0]|g_ram[1]<<8;
    history[i].ended=mode==0 || mode==2;
    return ok;
}
int rb_step(void) {
    if(dirty>=0) {
        int from=dirty;
        int s=from%SNAPSHOTS;
        if(snapshots[s].tag!=from || !RtlRollbackLoadFromMemory(snapshots[s].data,snapshots[s].size)) return 0;
        replay=from;dirty=-1;corrections++;
    }
    if(replay>=0) {
        int budget=REPLAY_BUDGET;
        while(replay<head && budget--) {
            if(!simulate(replay,0)) return 0;
            replay++;replayed++;
        }
        if(replay<head) return 3; /* correction in progress, no new audio/image */
        replay=-1;publish();
        if(smash_ui_state()!=MP_PLAY) return 2;
        return 3;
    }
    publish();
    if(smash_ui_state()!=MP_PLAY) return 2;
    if(head-received>=RB_WINDOW || history[head%HISTORY].local_tag!=head) {stalls++;return 2;}
    if(!simulate(head,1)) return 0;
    head++;publish();return 1;
}
