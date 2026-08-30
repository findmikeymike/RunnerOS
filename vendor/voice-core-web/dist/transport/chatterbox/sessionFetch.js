export function createChatterboxSessionFetch(baseFetch, approvedRoot, sessionToken, baseUrl) {
    const root = new URL(approvedRoot, baseUrl);
    return (async (input, init) => {
        const requestUrl = new URL(input instanceof Request ? input.url : String(input), baseUrl);
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        headers.delete("X-VoiceCore-Session");
        if (sessionToken
            && requestUrl.origin === root.origin
            && requestUrl.pathname.startsWith(root.pathname))
            headers.set("X-VoiceCore-Session", sessionToken);
        return baseFetch(input, { ...init, headers });
    });
}
//# sourceMappingURL=sessionFetch.js.map