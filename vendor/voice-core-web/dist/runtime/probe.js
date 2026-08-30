import { RuntimeWorkerClient } from "./worker";
import { AudioGraph } from "../audio/AudioGraph";
/** Verifies that the packaged worker and WASM runtime can initialize and stop. */
export async function probePackagedRuntime() {
    const client = new RuntimeWorkerClient();
    const audio = new AudioGraph();
    try {
        await Promise.all([client.init({}), audio.start({})]);
        await client.stop();
    }
    finally {
        await audio.stop();
        client.destroy();
    }
}
//# sourceMappingURL=probe.js.map