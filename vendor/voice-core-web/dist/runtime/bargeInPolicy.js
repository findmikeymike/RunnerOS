export function shouldDetectLocalBargeIn(enabled, state) {
    return enabled !== false && (state === "speaking" || state === "thinking");
}
//# sourceMappingURL=bargeInPolicy.js.map