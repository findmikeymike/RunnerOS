import { applyLutToRgba, type CubeLut } from '../../../../../../tools/video-studio/lib/color-pipeline.mjs'

/** GPU trilinear lookup; the CPU fallback uses the export pipeline's same LUT. */
export function createColorPreview() {
  const source = document.createElement('canvas')
  const output = document.createElement('canvas')
  const gl = output.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, depth: false, antialias: false })
  let program: WebGLProgram | null = null
  let sourceTexture: WebGLTexture | null = null
  let lutTexture: WebGLTexture | null = null
  let vertices: WebGLBuffer | null = null
  let cachedLut: CubeLut | null = null
  if (gl && gl.getExtension('OES_texture_float')) {
    const shader = (type: number, code: string) => {
      const result = gl.createShader(type)!
      gl.shaderSource(result, code); gl.compileShader(result)
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); return null }
      return result
    }
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=(p+1.0)*0.5;gl_Position=vec4(p,0,1);}')
    const fragment = shader(gl.FRAGMENT_SHADER, `precision highp float;
      varying vec2 uv; uniform sampler2D image; uniform sampler2D lut;
      uniform float size; uniform vec3 domainMin; uniform vec3 domainMax; uniform float strength;
      vec3 at(vec3 p){return texture2D(lut,vec2((p.r+p.g*size+0.5)/(size*size),(p.b+0.5)/size)).rgb;}
      void main(){vec4 c=texture2D(image,vec2(uv.x,1.0-uv.y));
        vec3 p=clamp((c.rgb-domainMin)/(domainMax-domainMin),0.0,1.0)*(size-1.0);
        vec3 lo=floor(p);vec3 hi=min(lo+1.0,size-1.0);vec3 f=p-lo;
        vec3 a=mix(mix(at(lo),at(vec3(hi.r,lo.g,lo.b)),f.r),mix(at(vec3(lo.r,hi.g,lo.b)),at(vec3(hi.r,hi.g,lo.b)),f.r),f.g);
        vec3 b=mix(mix(at(vec3(lo.r,lo.g,hi.b)),at(vec3(hi.r,lo.g,hi.b)),f.r),mix(at(vec3(lo.r,hi.g,hi.b)),at(hi),f.r),f.g);
        gl_FragColor=vec4(mix(c.rgb,mix(a,b,f.b),strength),c.a);
      }`)
    if (vertex && fragment) {
      program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); program = null }
    }
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    if (program) {
      gl.useProgram(program)
      vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0)
      sourceTexture = gl.createTexture(); lutTexture = gl.createTexture()
      gl.uniform1i(gl.getUniformLocation(program,'image'),0); gl.uniform1i(gl.getUniformLocation(program,'lut'),1)
    }
  }
  const bind = (unit: number, texture: WebGLTexture | null) => {
    gl!.activeTexture(unit); gl!.bindTexture(gl!.TEXTURE_2D,texture)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_S,gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_T,gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MIN_FILTER,gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MAG_FILTER,gl!.NEAREST)
  }
  return {
    draw(element: CanvasImageSource, crop: {x:number;y:number;width:number;height:number}, width:number, height:number, lut:CubeLut): HTMLCanvasElement {
      source.width=Math.max(1,Math.round(width)); source.height=Math.max(1,Math.round(height))
      const ctx=source.getContext('2d',{willReadFrequently:!program})!
      ctx.drawImage(element,crop.x,crop.y,crop.width,crop.height,0,0,source.width,source.height)
      if (gl && program && !gl.isContextLost()) {
        output.width=source.width; output.height=source.height
        gl.viewport(0,0,output.width,output.height); gl.useProgram(program)
        bind(gl.TEXTURE0,sourceTexture)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false)
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source)
        bind(gl.TEXTURE1,lutTexture)
        if (cachedLut!==lut) {
          const rgba=new Float32Array(lut.size**3*4)
          for(let i=0,j=0;i<lut.values.length;i+=3,j+=4){rgba[j]=lut.values[i]!;rgba[j+1]=lut.values[i+1]!;rgba[j+2]=lut.values[i+2]!;rgba[j+3]=1}
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,lut.size*lut.size,lut.size,0,gl.RGBA,gl.FLOAT,rgba)
          gl.uniform1f(gl.getUniformLocation(program,'size'),lut.size)
          gl.uniform3fv(gl.getUniformLocation(program,'domainMin'),lut.domainMin??[0,0,0])
          gl.uniform3fv(gl.getUniformLocation(program,'domainMax'),lut.domainMax??[1,1,1])
          gl.uniform1f(gl.getUniformLocation(program,'strength'),lut.intensity??1)
          cachedLut=lut
        }
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
        return output
      }
      const pixels=ctx.getImageData(0,0,source.width,source.height)
      applyLutToRgba(pixels.data,lut);ctx.putImageData(pixels,0,0)
      return source
    },
    dispose(){ if(gl){gl.deleteTexture(sourceTexture);gl.deleteTexture(lutTexture);gl.deleteBuffer(vertices);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext()} source.width=0;output.width=0 }
  }
}
