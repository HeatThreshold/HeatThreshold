// PLACEHOLDER — esbuild overwrites this file during the Vercel buildCommand.
//
// Why a placeholder is committed: Vercel parses vercel.json's `functions`
// config BEFORE buildCommand runs. If api/index.js doesn't exist at
// pre-build time, the deploy fails with:
//   "The pattern api/index.js defined in `functions` doesn't match any
//    Serverless Functions inside the `api` directory."
//
// So this file exists as a marker. The real bundled handler comes from
// api-src/handler.ts → esbuild → api/index.js during deploy.
//
// If you ever see this stub running in production, the buildCommand failed
// to produce the real bundle — check vercel.json and the deploy logs.
module.exports = function placeholderHandler(req, res) {
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'Stub function is running — esbuild build step did not produce the real bundle.',
    hint: 'Check vercel.json buildCommand step and the deploy build logs.'
  }));
};
module.exports.default = module.exports;
