import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyLutToRgba, buildColorLut, parseCubeLut, sampleLutRgb, serializeCubeLut, validateColorAdjustments, validateCubeLut } from './color-pipeline.mjs';
import { renderSimpleMp4 } from './render-engine.mjs';

function cube(transform = ([r,g,b]) => [r,g,b], size = 2) {
  const values=[];
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++)values.push(...transform([r/(size-1),g/(size-1),b/(size-1)]));
  return {name:'Fixture',size,values};
}
function ffmpeg(args,input) {
  const result=spawnSync('ffmpeg',['-v','error',...args],{input,maxBuffer:20*1024*1024});
  expect(result.status,result.stderr.toString()).toBe(0);
  return result.stdout;
}

describe('inline cube validation and canonical color',()=>{
  test('parses BOM/comments/domain/red-fastest cube and preserves alpha',()=>{
    const lut=parseCubeLut('\uFEFF# Comment\nTITLE "example"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n'+cube().values.reduce((rows,v,i)=>rows+v+(i%3===2?'\n':' '),''),'Identity');
    expect(lut.name).toBe('Identity');
    const data=new Uint8ClampedArray([13,87,209,47,255,0,128,255]);
    expect([...applyLutToRgba(data,lut)]).toEqual([13,87,209,47,255,0,128,255]);
  });
  test('trilinear interpolation and intensity combine without changing alpha',()=>{
    const lut={...cube(([r,g,b])=>[1-r,1-g,1-b]),intensity:.25};
    expect(sampleLutRgb(lut,.2,.4,.8)).toEqual([.35000000000000003,.45,.65]);
    expect([...applyLutToRgba(new Uint8ClampedArray([0,255,128,91]),lut)]).toEqual([64,191,128,91]);
  });
  test.each([
    {...cube(),size:34}, {...cube(),values:[0,0,0]}, {...cube(),values:[NaN,...cube().values.slice(1)]},
    {...cube(),domainMin:[1,0,0]}, {...cube(),intensity:2}, {...cube(),domainMax:[1,1]}, {...cube(),values:new Array(24)},
  ])('rejects malformed LUT %j',lut=>expect(()=>validateCubeLut(lut)).toThrow());
  test('rejects unsupported cube forms, excess entries, duplicate metadata and invalid numeric controls',()=>{
    for(const text of ['LUT_1D_SIZE 2\n0 0 0','LUT_3D_SIZE 65','LUT_3D_SIZE 2\n0 0 NaN','LUT_3D_SIZE 2\nLUT_3D_SIZE 2'])expect(()=>parseCubeLut(text)).toThrow();
    expect(()=>validateColorAdjustments({pipeline:'unknown'})).toThrow();
    expect(()=>validateColorAdjustments({exposure:Infinity})).toThrow();
    expect(()=>validateColorAdjustments({lut:{name:'bad'}})).toThrow();
  });
  test('legacy controls remain legacy; rgb-v1 true temperature separates red/blue',()=>{
    expect(buildColorLut({exposure:.2})).toBeNull();
    expect(()=>validateColorAdjustments({exposure:2})).not.toThrow();
    expect(()=>validateColorAdjustments({pipeline:'rgb-v1',exposure:2})).toThrow();
    const lut=buildColorLut({pipeline:'rgb-v1',temperature:.5});
    const [r,g,b]=sampleLutRgb(lut,.5,.5,.5);
    expect(r).toBeGreaterThan(g);expect(b).toBeLessThan(g);
  });
  test('actual FFmpeg trilinear pixels match browser for numeric color plus imported LUT/intensity',()=>{
    const dir=mkdtempSync(join(tmpdir(),'color-parity-'));
    try {
      const lut=buildColorLut({pipeline:'rgb-v1',exposure:.15,contrast:1.12,saturation:.7,temperature:.12,tint:-.08,highlights:-.2,shadows:.1,lut:{...cube(([r,g,b])=>[b,g,r]),intensity:.6}});
      const path=join(dir,'color.cube');writeFileSync(path,serializeCubeLut(lut));
      const pixels=Buffer.from(Array.from({length:16*3},(_,i)=>(i*37+23)%256));
      const output=ffmpeg(['-f','rawvideo','-pixel_format','rgb24','-video_size','4x4','-i','pipe:0','-vf',`lut3d=file=${path}:interp=trilinear`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],pixels);
      const rgba=new Uint8ClampedArray(16*4);
      for(let i=0;i<16;i++)rgba.set([...pixels.subarray(i*3,i*3+3),255],i*4);
      applyLutToRgba(rgba,lut);
      for(let i=0;i<16;i++)for(let c=0;c<3;c++)expect(Math.abs(output[i*3+c]-rgba[i*4+c])).toBeLessThanOrEqual(1);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  test('domain and fractional intensity are baked identically for browser and exported table',()=>{
    const lut={...cube(([r,g,b])=>[1-r,g,b]),domainMin:[.1,.2,.3],domainMax:[.9,.8,.7],intensity:.4};
    const baked=buildColorLut({pipeline:'rgb-v1',lut});
    const emitted=parseCubeLut(serializeCubeLut(baked));
    for(const rgb of [[0,0,0],[.25,.5,.75],[1,1,1]]) {
      const a=sampleLutRgb(baked,...rgb),b=sampleLutRgb(emitted,...rgb);
      a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],7));
    }
  });
  test('full renderer applies RGB LUT after crop/scale and preserves rotated translucent alpha',()=>{
    const dir=mkdtempSync(join(tmpdir(),'color-export-'));
    try {
      const image=join(dir,'source.ppm'),out=join(dir,'export.mp4');
      const rgb=[80,140,200];writeFileSync(image,Buffer.concat([Buffer.from('P6\n128 64\n255\n'),Buffer.from(Array.from({length:128*64*3},(_,i)=>Math.floor(i/3)%128<64 ? rgb[i%3] : [220,20,30][i%3]))]));
      const adjustments={pipeline:'rgb-v1',temperature:.3,saturation:.75};
      renderSimpleMp4({title:'Color',settings:{width:64,height:64,fps:5},media:[{id:'m',type:'image',path:image,width:128,height:64}],timeline:{durationMs:400,tracks:[{id:'v',clips:[{id:'c',type:'image',mediaId:'m',startMs:0,durationMs:400,opacity:.5,crop:{x:0,y:0,width:64,height:64},transform:{scale:.5,rotateDeg:45},adjustments}]}]},captions:[]},out);
      const pixels=ffmpeg(['-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
      const expected=sampleLutRgb(buildColorLut(adjustments),...rgb.map(v=>v/255)).map(v=>v*255*.5+17*.5);
      expected.forEach((v,i)=>expect(Math.abs(pixels[(32*64+32)*3+i]-v)).toBeLessThan(9));
      for(let channel=0;channel<3;channel++)expect(Math.abs(pixels[(4*64+4)*3+channel]-17)).toBeLessThan(5);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
});

describe('exported color preserves source alpha', () => {
  const effects = [
    {}, // No adjustments remains a direct composition path for legacy clips.
    { exposure: 0.15 },
    { vignette: 0.5 },
    { exposure: 0.1, grain: 0.3, sharpen: 0.4, vignette: 0.5 },
  ];
  for (const pipeline of [undefined, 'rgb-v1']) for (const effect of effects) {
    test(`${pipeline ?? 'legacy'} ${JSON.stringify(effect)} retains transparent pixels and partial alpha with opacity`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'color-alpha-'));
      try {
        const adjustments = { ...effect, ...(pipeline ? { pipeline } : {}) };
        const frame = (alpha, opacity) => {
          const path = join(dir, `source-${alpha}.png`), output = join(dir, `out-${alpha}-${opacity}.mp4`);
          const pixels = Buffer.from(Array.from({ length: 64 * 64 * 4 }, (_, i) => [120, 70, 200, alpha][i % 4]));
          ffmpeg(['-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '64x64', '-i', 'pipe:0', '-frames:v', '1', path], pixels);
          renderSimpleMp4({ title: 'Alpha', settings: { width: 64, height: 64, fps: 5 },
            media: [{ id: 'm', type: 'image', path, width: 64, height: 64 }],
            timeline: { durationMs: 400, tracks: [{ id: 'v', clips: [{ id: 'c', type: 'image', mediaId: 'm', startMs: 0, durationMs: 400, adjustments, opacity }] }] }, captions: [] }, output);
          return ffmpeg(['-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
        };
        const opaque = frame(255, 1), transparent = frame(0, 0.5), partial = frame(128, 0.5);
        // Average an interior region to avoid MP4 chroma/noise quantization;
        // grading the opaque source independently supplies the RGB reference.
        const average = (pixels, channel) => {
          let sum = 0;
          for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) sum += pixels[(y * 64 + x) * 3 + channel];
          return sum / 1024;
        };
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(average(transparent, channel) - 17)).toBeLessThan(3);
          const expected = average(opaque, channel) * (128 / 255 * 0.5) + 17 * (1 - 128 / 255 * 0.5);
          expect(Math.abs(average(partial, channel) - expected)).toBeLessThan(5);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
  test('multiple graded layers have independent alpha graphs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'color-alpha-layers-'));
    try {
      const path = join(dir, 'transparent.png'), output = join(dir, 'layers.mp4');
      ffmpeg(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '32x32', '-i', 'pipe:0', '-frames:v', '1', path],
        Buffer.from(Array.from({ length: 32 * 32 * 4 }, (_, i) => [255, 0, 0, 0][i % 4])));
      renderSimpleMp4({ title: 'Layers', settings: { width: 32, height: 32, fps: 5 },
        media: [{ id: 'm', type: 'image', path, width: 32, height: 32 }],
        timeline: { durationMs: 400, tracks: [undefined, 'rgb-v1'].map((pipeline, i) => ({ id: `v${i}`, clips: [{ id: `c${i}`, type: 'image', mediaId: 'm', startMs: 0, durationMs: 400, adjustments: { vignette: 0.5, ...(pipeline ? { pipeline } : {}) } }] })) }, captions: [] }, output);
      const pixels = ffmpeg(['-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(pixels[(16 * 32 + 16) * 3 + channel] - 17)).toBeLessThan(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
