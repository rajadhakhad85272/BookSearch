import { proxyBackend } from '../../lib/backend-proxy.js';

export default function onRequest(context) {
    return proxyBackend(context.request);
}
