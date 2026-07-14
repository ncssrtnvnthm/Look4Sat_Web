import type { Plugin } from 'vite';

/**
 * Vite plugin that proxies Celestrak requests in dev mode.
 * Uses Node's native fetch (Node 18+) with proper headers.
 */
export function celestrakProxy(): Plugin {
  return {
    name: 'celestrak-proxy',
    configureServer(server) {
      server.middlewares.use('/api/celestrak', async (req, res) => {
        // Strip the /api/celestrak prefix from the incoming path
        const upstreamPath = (req.url || '/').replace(/^\/api\/celestrak/, '') || '/';
        const targetUrl = 'https://celestrak.org' + upstreamPath;

        console.log(`[celestrak-proxy] → ${targetUrl}`);

        try {
          const upstream = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Look4Sat/4.4.3',
              'Accept': 'text/plain,text/csv,*/*',
            },
            redirect: 'follow',
          });

          res.statusCode = upstream.status;

          if (upstream.ok) {
            const text = await upstream.text();
            res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'text/plain');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(text);
          } else {
            const body = await upstream.text().catch(() => '');
            console.error(`[celestrak-proxy] Upstream ${upstream.status}: ${body.slice(0, 200)}`);
            res.setHeader('Content-Type', 'text/plain');
            res.end(`Upstream error ${upstream.status}: ${body.slice(0, 500)}`);
          }
        } catch (err) {
          console.error('[celestrak-proxy] Fetch error:', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`Proxy error: ${err}`);
        }
      });

      server.middlewares.use('/api/satnogs', async (req, res) => {
        const upstreamPath = (req.url || '/').replace(/^\/api\/satnogs/, '') || '/';
        const targetUrl = 'https://db.satnogs.org' + upstreamPath;

        console.log(`[satnogs-proxy] → ${targetUrl}`);

        try {
          const upstream = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Look4Sat/4.4.3',
              'Accept': 'application/json',
            },
          });

          res.statusCode = upstream.status;

          if (upstream.ok) {
            const text = await upstream.text();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(text);
          } else {
            const body = await upstream.text().catch(() => '');
            console.error(`[satnogs-proxy] Upstream ${upstream.status}: ${body.slice(0, 200)}`);
            res.setHeader('Content-Type', 'text/plain');
            res.end(`Upstream error ${upstream.status}: ${body.slice(0, 500)}`);
          }
        } catch (err) {
          console.error('[satnogs-proxy] Fetch error:', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`Proxy error: ${err}`);
        }
      });
    },
  };
}
