# Deployment

The addon remains a normal Node.js Stremio addon. Build it with `mise exec -- npm ci` followed by `mise exec -- npm run build`, then start `dist/index.js` with `PORT` set by the hosting platform. `Procfile` and `beamup.json` retain the repository's existing deployment entry points.

Before publishing, run `mise exec -- npm run verify:deployment`. It builds and starts the production entry point on a temporary local port, then verifies readiness, manifest, configuration, and stream-route contracts.

Expose the service over HTTPS and verify these endpoints before installing it in Stremio:

- `/startup` and `/ready` return `{ "status": "ok" }`;
- `/manifest.json` returns the `fmhy-webstream` manifest by default;
- `/configure` renders the configuration page;
- `/stream/movie/<id>.json` reaches the stream adapter.

Production deployments may set `MANIFEST_ID` and `MANIFEST_NAME`, but each independently deployed fork must keep a unique manifest ID. FMHY synchronization is maintenance work and must not run on the user stream-request path.

Set `TMDB_ACCESS_TOKEN` on the addon process so Stremio IMDb/TMDB IDs can be resolved to the titles and years required by maintained source-family searches. Without it, audited FMHY source-family results cannot resolve ordinary Stremio requests.

Run `mise exec -- npm run maintain:extractability` as a separate long-lived maintenance process. It refreshes the persisted FMHY source registry and dependency report every six hours by default. The addon process notices atomic registry updates every minute by default, so a successful maintenance run becomes available without restarting the server.
