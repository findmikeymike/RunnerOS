import { describe, test, expect } from 'bun:test';
import { buildScenePlan, sceneAtTime, visualGeometry } from './scene-plan.mjs';
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
