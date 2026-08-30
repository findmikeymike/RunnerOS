let wasmModulePromise = null;
export async function ensureWasmModule() {
    if (!wasmModulePromise) {
        wasmModulePromise = import("../../pkg/conversational_web.js")
            .then(async (module) => {
            const init = module.default;
            if (typeof init === "function") {
                await init();
            }
            return module;
        })
            .catch((error) => {
            wasmModulePromise = null;
            throw error;
        });
    }
    return wasmModulePromise;
}
//# sourceMappingURL=wasm.js.map