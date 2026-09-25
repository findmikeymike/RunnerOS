import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { buildScenePlan, sceneAtTime, visualGeometry, audioGainAtTime, clipVolume, clipFadeSeconds, validateRenderCapabilities } from './scene-plan.mjs';
function project() {
    return { title: 'Scene', settings: {width: 320,height: 240,fps: 30},
        media: [{id:'m',type:'video',path:'fixture.mp4',width:640,height:480,durationMs:20000}],
        timeline: {durationMs:9000, tracks:[{id:'base',clips:[{id:'v',type:'video',mediaId:'m',startMs:1000,durationMs:2000,sourceInMs:500,speed:2}]}]}, captions:[] };
}
describe('browser-safe scene contract', () => {
    test('source clocks, active duration, gaps and inclusive boundaries follow export', () => {
        const plan=buildScenePlan(project());
        expect(plan.durationMs).toBe(3000);
        expect(sceneAtTime(plan,0).visuals).toHaveLength(0);
        expect(sceneAtTime(plan,1500).visuals[0].sourceTimeMs).toBe(1500);
        expect(sceneAtTime(plan,3000).visuals).toHaveLength(1);
        expect(sceneAtTime(plan,3001).visuals).toHaveLength(0);
    });
    test('layer order follows track order then time; hidden and disabled layers disappear', () => {
        const p=project(); const v=p.timeline.tracks[0].clips[0];
        p.timeline.tracks[0].clips=[{...v,id:'later',startMs:1500},v,{...v,id:'disabled',disabled:true}];
        p.timeline.tracks.push({id:'upper',clips:[{...v,id:'upper'}]}, {id:'hidden',hidden:true,clips:[{...v,id:'hidden'}]});
        expect(sceneAtTime(buildScenePlan(p),1600).visuals.map(({clip})=>clip.id)).toEqual(['v','later','upper']);
    });
    test('crop, contain fit, scale, rotation, alpha and position interpolation share geometry', () => {
        const p=project();const clip=p.timeline.tracks[0].clips[0];
        Object.assign(clip,{crop:{x:20,y:10,width:200,height:100},transform:{x:10,y:20,scale:0.5,rotateDeg:90},opacity:0.4,keyframes:[{property:'x',timeMs:1000,value:110}]});
        const plan=buildScenePlan(p);
        expect(plan.issues).toEqual([]);
        expect(sceneAtTime(plan,1500).visuals[0].geometry).toEqual({crop:clip.crop,width:160,height:80,x:220,y:140,rotateDeg:90,opacity:0.4});
        expect(sceneAtTime(plan,2900).visuals[0].geometry.x).toBe(270);
        expect(visualGeometry({...clip,crop:undefined,transform:{}},{...p.media[0],width:100,height:200},320,240,1500).width).toBe(120);
    });
    test('text layout retains original clip order and 200ms minimum; captions use timeline positions', () => {
        const p=project();
        p.timeline.tracks.push({id:'text',clips:[{id:'t',type:'text',text:{text:'Title'},startMs:1000,durationMs:50},{id:'c',type:'caption',captionCueIds:['cue'],startMs:2000,durationMs:500}]});
        p.captions=[{cues:[{id:'cue',text:'Caption',startMs:50,durationMs:100}]}];
        const plan=buildScenePlan(p);
        expect(plan.titles[0]).toEqual({text:'Title',startMs:1000,endMs:1200,fontSize:28,y:101});
        expect(plan.captions[0]).toEqual({text:'Caption',startMs:2000,endMs:2500,fontSize:24,bottom:48,boxBorder:10});
        expect(sceneAtTime(plan,1500).captions).toEqual([]);
        expect(sceneAtTime(plan,2200).captions).toHaveLength(1);
        p.timeline.tracks[1].hidden=true;
        expect(buildScenePlan(p).captions).toEqual([]);
    });
    test('empty scenes retain fallback title but audio-only projects do not invent text', () => {
        const p=project();p.timeline.tracks=[];
        expect(buildScenePlan(p).titles[0].centered).toBe(true);
        p.media[0].type='audio';p.timeline.tracks=[{id:'a',clips:[{id:'a',type:'audio',mediaId:'m',startMs:0,durationMs:1000}]}];
        expect(buildScenePlan(p).titles).toEqual([]);
    });
    test('preview blocks unsupported looks and render effects but permits neutral settings', () => {
        const p=project();const clip=p.timeline.tracks[0].clips[0];
        clip.adjustments={preset:'neutral',contrast:1,exposure:0};
        expect(buildScenePlan(p).issues).toEqual([]);
        clip.adjustments.exposure=0.2;
        expect(buildScenePlan(p).issues.map(i=>i.code)).toContain('preview-unsupported-adjustments');
        clip.transitionIn={type:'crossfade'};
        expect(buildScenePlan(p).issues.map(i=>i.code)).toContain('unsupported-transition');
    });
});


describe('shared audio scene', () => {
    function audioProject() {
        const p = project();
        p.media = [{id:'tone',type:'audio',path:'tone.wav'}, {id:'silent',type:'video',path:'silent.mp4',hasAudio:false}, {id:'unknown',type:'video',path:'unknown.mp4'}];
        p.timeline.tracks = [{id:'sound',clips:[
            {id:'first',type:'audio',mediaId:'tone',startMs:0,durationMs:1000},
            {id:'future',type:'audio',mediaId:'tone',startMs:2000,durationMs:1000,volume:0},
            {id:'silent',type:'video',mediaId:'silent',startMs:0,durationMs:4000},
            {id:'unknown',type:'video',mediaId:'unknown',startMs:0,durationMs:4000},
        ]}, {id:'muted',muted:true,clips:[{id:'muted',type:'audio',mediaId:'tone',startMs:0,durationMs:4000}]},
        {id:'hidden',hidden:true,clips:[{id:'hidden',type:'audio',mediaId:'tone',startMs:0,durationMs:4000}]}];
        return p;
    }
    test('candidate policy excludes disabled, hidden and muted tracks; even stale hasAudio false requires a real probe', () => {
        const p = audioProject();
        p.timeline.tracks[0].clips.push({id:'disabled',type:'audio',mediaId:'tone',startMs:0,durationMs:1000,disabled:true});
        expect(buildScenePlan(p).audio.map(a=>a.clip.id)).toEqual(['first','silent','unknown','future']);
    });
    test('normalization includes future and zero-volume streams but excludes ended or disproven video streams', () => {
        const plan = buildScenePlan(audioProject());
        const first = plan.audio.find(a=>a.clip.id==='first');
        const future = plan.audio.find(a=>a.clip.id==='future');
        expect(audioGainAtTime(plan,first,500)).toBeCloseTo(1/4);
        expect(audioGainAtTime(plan,first,500,new Set(['first','future']))).toBe(0.5);
        expect(audioGainAtTime(plan,first,1000)).toBe(0);
        expect(audioGainAtTime(plan,future,2500)).toBe(0);
        future.clip.volume = 1;
        expect(audioGainAtTime(plan,future,2500,new Set(['first','future']))).toBe(1);
        expect(sceneAtTime(plan,1000).audio.map(a=>a.clip.id)).not.toContain('first');
    });
    test('gain clamps volume and caps linear fades at half duration; source clocks honor speed and source in', () => {
        const p=audioProject();
        p.timeline.tracks[0].clips=[{id:'faded',type:'audio',mediaId:'tone',startMs:1000,durationMs:2000,sourceInMs:500,speed:2,volume:8,fadeInMs:5000,fadeOutMs:5000}];
        const plan=buildScenePlan(p), audio=plan.audio[0];
        expect(clipVolume(audio.clip)).toBe(4);
        expect(clipFadeSeconds(audio.clip,'fadeInMs')).toBe(1);
        expect(audioGainAtTime(plan,audio,1000)).toBe(0);
        expect(audioGainAtTime(plan,audio,1500)).toBe(2);
        expect(audioGainAtTime(plan,audio,2000)).toBe(4);
        expect(audioGainAtTime(plan,audio,2500)).toBe(2);
        expect(sceneAtTime(plan,1500).audio[0].sourceTimeMs).toBe(1500);
    });
    test('real FFmpeg retains zero-volume streams in its normalization denominator', () => {
        const result=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.4:s=48000:d=1','-f','lavfi','-i','aevalsrc=0.2:s=48000:d=2','-filter_complex','[1:a]volume=0[b];[0:a][b]amix=inputs=2:duration=longest:dropout_transition=0[a]','-map','[a]','-f','f32le','-'],{maxBuffer:4*48000*4});
        expect(result.status,result.stderr.toString()).toBe(0);
        expect(result.stdout.readFloatLE(24000*4)).toBeCloseTo(0.2,5);
        expect(result.stdout.readFloatLE(72000*4)).toBeCloseTo(0,5);
    });
    test('real FFmpeg delayed amix samples agree with future-stream and EOF normalization', () => {
        const result=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.4:s=48000:d=1','-f','lavfi','-i','aevalsrc=0.2:s=48000:d=1','-filter_complex','[1:a]adelay=2000:all=1[b];[0:a][b]amix=inputs=2:duration=longest:dropout_transition=0[a]','-map','[a]','-f','f32le','-'],{maxBuffer:4*48000*4});
        expect(result.status,result.stderr.toString()).toBe(0);
        const p=audioProject();p.timeline.tracks=[{id:'sound',clips:p.timeline.tracks[0].clips.slice(0,2)}];
        p.timeline.tracks[0].clips[1].volume=1;
        const plan=buildScenePlan(p);
        for(const time of [100,500,1200,2200,2500]) {
            const expected=0.4*audioGainAtTime(plan,plan.audio[0],time)+0.2*audioGainAtTime(plan,plan.audio[1],time);
            expect(result.stdout.readFloatLE(Math.round(time*48)*4)).toBeCloseTo(expected,5);
        }
    });
});

test('RGB color is previewable while nonvisual grades and legacy texture stay explicit', () => {
 const p=project(), clip=p.timeline.tracks[0].clips[0];
 clip.adjustments={pipeline:'rgb-v1',exposure:0.5,temperature:0.2};
 expect(buildScenePlan(p).issues).toEqual([]);
 clip.adjustments.grain=0.1;
 expect(buildScenePlan(p).issues.some(i=>i.code==='preview-unsupported-adjustments')).toBe(true);
 clip.type='text';delete clip.mediaId;
 expect(validateRenderCapabilities(p).issues.some(i=>i.code==='unsupported-color')).toBe(true);
});
