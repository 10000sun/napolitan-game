// Cloudflare 워커 입구. D1·KV 를 한 번 연결하고, 맡지 않는 경로는 정적 파일로.
import { useStore } from './db.js';
import { d1Store } from './store.js';
import { useImages } from './assets.js';
import { handle } from './app.js';

let bound = false;

export default {
  async fetch(request, env) {
    if (!bound) {
      useStore(d1Store(env.DB));
      useImages({
        put: (file, bytes, type) => env.IMAGES.put(`obj/${file}`, bytes, { metadata: { type } }),
        get: async (file) => {
          const r = await env.IMAGES.getWithMetadata(`obj/${file}`, 'arrayBuffer');
          return r.value ? { bytes: r.value, type: r.metadata?.type || 'image/png' } : null;
        },
      });
      bound = true;
    }
    return (await handle(request)) || env.ASSETS.fetch(request);
  },
};
