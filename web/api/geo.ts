// Visitor country, only to pick the first language of the UI. Vercel sets the header from
// the IP; the IP itself is never read, logged or stored here. Outside src/, so neither the
// Vite build nor `tsc -p .` picks it up: Vercel compiles it as a function.
export function GET(request: Request) {
  return Response.json(
    { country: request.headers.get("x-vercel-ip-country") ?? "" },
    { headers: { "cache-control": "private, no-store" } },
  );
}
