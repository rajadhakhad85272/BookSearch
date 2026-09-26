// Fixed backend: never accept an origin or target URL from the client.
const BACKEND_ORIGIN = 'http://88.96.42.58';
const PUBLIC_HOST = 'book.laiye.site';
const NO_STORE = 'private, no-store, max-age=0';
const HOP_HEADERS = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
];

function removeHopHeaders(headers) {
    const connection = headers.get('connection');
    if (connection) {
        for (const name of connection.split(',')) headers.delete(name.trim());
    }
    for (const name of HOP_HEADERS) headers.delete(name);
    headers.delete('content-length');
}

function isBackendPath(pathname) {
    // Nginx decodes paths; reject encoded separators and traversal before forwarding.
    if (/%2f|%5c/i.test(pathname)) return false;
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { return false; }
    if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) return false;
    return /^\/(?:api|manage)(?:\/|$)/.test(decoded) ||
        /^\/static\/search_manage(?:\/|$)/.test(decoded);
}

function rewriteLocation(location, publicOrigin) {
    if (!location || !/^(?:https?:)?\/\//i.test(location)) return location;
    try {
        const target = new URL(location, BACKEND_ORIGIN);
        if (target.hostname === new URL(BACKEND_ORIGIN).hostname || target.hostname === PUBLIC_HOST) {
            return publicOrigin + target.pathname + target.search + target.hash;
        }
    } catch { /* Keep upstream redirects that are not absolute HTTP URLs unchanged. */ }
    return location;
}

export async function proxyBackend(request) {
    const clientURL = new URL(request.url);
    if (!isBackendPath(clientURL.pathname)) {
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': NO_STORE } });
    }
    const dynamic = !clientURL.pathname.startsWith('/static/search_manage');
    const target = new URL(BACKEND_ORIGIN);
    target.pathname = clientURL.pathname;
    target.search = clientURL.search;
    const headers = new Headers(request.headers);
    removeHopHeaders(headers);
    for (const name of ['forwarded', 'x-forwarded-for', 'x-real-ip']) headers.delete(name);
    headers.set('Host', PUBLIC_HOST);
    headers.set('X-Forwarded-Host', PUBLIC_HOST);
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('Accept-Encoding', 'identity');
    // Preserve Origin and Referer so Django still validates the browser's CSRF origin.
    if (dynamic) {
        headers.set('Cache-Control', 'no-store');
        headers.set('Pragma', 'no-cache');
        headers.delete('if-none-match');
        headers.delete('if-modified-since');
    }
    try {
        const upstream = await fetch(target.href, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
            redirect: 'manual',
            eo: { timeoutSetting: { connectTimeout: 10000, readTimeout: 300000, writeTimeout: 30000 } }
        });
        const responseHeaders = new Headers(upstream.headers);
        removeHopHeaders(responseHeaders);
        // Preserve each Set-Cookie separately, including Expires values containing commas.
        const cookies = upstream.headers.getSetCookie();
        responseHeaders.delete('set-cookie');
        for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);
        const location = rewriteLocation(responseHeaders.get('location'), clientURL.origin);
        if (location) responseHeaders.set('Location', location);
        if (dynamic) {
            responseHeaders.set('Cache-Control', NO_STORE);
            responseHeaders.set('CDN-Cache-Control', 'no-store');
            responseHeaders.set('Pragma', 'no-cache');
            responseHeaders.set('Expires', '0');
        }
        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders
        });
    } catch {
        return new Response('Backend temporarily unavailable', {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE }
        });
    }
}
