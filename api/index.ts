import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/server/createApp';

// Build the Express app once per cold start.
const app = createApp();

// Vercel's @vercel/node runtime expects the default export to be an explicit
// (req, res) request handler. An Express app instance IS callable with that
// signature, but exporting it directly has been known to trip the dispatcher
// depending on the runtime version. Wrapping it explicitly is the safe form.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
