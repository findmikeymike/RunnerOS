import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
// No global mocks. Browser objects and clock are confined to a VM per fixture.
export async function playbackHarness(sdkRoot?: string) {
  const base = resolve(sdkRoot ?? 'vendor/voice-core-web');
  let now = 1000, nextTimer = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock = { setTimeout: (fn: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout: (id: number) => timers.delete(id) };
  const outputs: any[] = [];
  class Track { readyState = 'live'; addEventListener() {} removeEventListener() {} stop() { this.readyState = 'ended'; } }
  const track = new Track();
  class Context {
    sampleRate = 48000; state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} };
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    async resume() {} async close() { this.state = 'closed'; } addEventListener() {} removeEventListener() {}
  }
  class Node {
    port: any = { onmessage: null, postMessage() {} }; onprocessorerror: any;
    processor: any;
    constructor(_context: any, name: string, options: any) {
      if (name !== 'voice-core-output') return;
      let Processor: any;
      const port = this.port;
      const scope = { Float32Array, Math, sampleRate: 48000,
        AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (data: any) => port.onmessage?.({ data }) }; },
        registerProcessor: (_name: string, cls: any) => { Processor = cls; } };
      vm.runInNewContext(readFileSync(join(base, 'dist/audio/output-worklet.js'), 'utf8'), scope);
      this.processor = new Processor(options);
      port.postMessage = (data: any) => this.processor.port.onmessage({ data }); outputs.push(this);
    }
    connect() {} disconnect() {}
  }
  const globals: any = { ...clock, window: { ...clock, AudioContext: Context }, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    MediaStreamAudioSourceNode: class { connect() {} disconnect() {} }, AudioWorkletNode: Node,
    URL, AbortController, Promise, Float32Array, Int16Array, Uint8Array, Map, Set,
    Date: class extends Date { static now() { return now; } }, console,
  };
  const cache = new Map<string, any>();
  // Only import binding syntax / import.meta URL changes. Every production method body is untouched.
  async function load(file: string, className: string): Promise<any> {
    if (cache.has(file)) return cache.get(file);
    const source = readFileSync(file, 'utf8'); const deps: any = {};
    for (const m of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";/gm)) {
      const path = resolve(dirname(file), m[2]!); const target = path.endsWith('.js') ? path : path + '.js';
      for (const name of m[1]!.split(',').map(s => s.trim())) {
        if (['AudioGraph', 'RuntimeWorkerClient', 'OutputAdmissionTracker'].includes(name)) deps[name] = await load(target, name);
        else deps[name] = (await import(pathToFileURL(target).href))[name];
      }
    }
    const code = source.replace(/^import .*;\n/gm, '').replace(`export class ${className}`, `class ${className}`).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
    const sandbox = { ...globals, ...deps };
    const Class = vm.runInNewContext(code + `\n${className}`, sandbox); cache.set(file, Class); return Class;
  }
  const Class = await load(join(base, 'dist/VoiceCoreWeb.js'), 'VoiceCoreWeb');
  const runtime: any = new Class({});
  const wasm = await import(pathToFileURL(join(base, 'pkg/conversational_web.js')).href);
  wasm.initSync({ module: readFileSync(join(base, 'pkg/conversational_web_bg.wasm')) });
  const engine = new wasm.WebRuntime('{}');
  const commands: string[] = [];
  const self: any = { postMessage: (data: any) => runtime.runtimeWorker.handleRuntimeMessage({ data }) };
  // Use exact shipped command/event adapter, injecting only already initialized WASM.
  vm.runInNewContext(readFileSync(join(base, 'dist/runtime/runtime.worker.js'), 'utf8').replace('let runtime = null;', 'let runtime = engine;'), { self, engine, BigInt, JSON, console });
  runtime.runtimeWorker.worker = { postMessage: (data: any) => { commands.push(data.type); self.onmessage({ data }); }, removeEventListener() {}, terminate() {} };
  runtime.runtimeWorker.ready = true;
  const events: any[] = [], frames: any[] = [], spoken: string[] = [];
  runtime.onEvent((e: any) => events.push(e)); runtime.onPlaybackFrame((f: any) => frames.push(f));
  await runtime.audioGraph.start({});
  runtime.running = true; runtime.runtimeStatus = 'running';
  await runtime.runtimeWorker.start(); await runtime.runtimeWorker.startListening();
  runtime.transports = {
    llm: { retryEmptyResponse: false, generateReply: async () => (async function* () { yield { text: 'An ordinary answer about music.', done: true }; })() },
    tts: { synthesize: async ({ text }: any) => { spoken.push(text); return (async function* () { yield { frames: new Float32Array(9600).fill(0.25), sampleRate: 48000, channels: 1,
      visemes: [{ startMs: 0, endMs: 100, viseme: 'PP' }, { startMs: 100, endMs: 200, viseme: 'O' }] }; })(); } },
  };
  async function settle() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
  async function consume(blocks = 1) { for (let i = 0; i < blocks; i++) { outputs[0].processor.process([], [[new Float32Array(128)]]); await settle(); } }
  async function drain() { await settle(); runtime.clearDrainTimer(); await runtime.drainOutputAudio(); await settle(); }
  async function advance(ms: number) { now += ms; const ready = [...timers].filter(([,t]) => t.at <= now); for (const [id,t] of ready) { if (!timers.delete(id)) continue; t.fn(); } await settle(); }
  async function close() { runtime.running = false; runtime.abortResponsePipeline(); runtime.clearDrainTimer(); await runtime.audioGraph.stop(); runtime.runtimeWorker.destroy(); engine.free(); timers.clear(); }
  return { runtime, engine, commands, events, frames, spoken, outputs, settle, consume, drain, advance, close, now: () => now, timers };
}
