# P10.1 local native transport

Checks fixed before implementation:

- Native operations are disabled by default. Only a trusted explicit startup
  JSON file selects release, endpoint and private state root; browser requests
  cannot supply filesystem paths, release identities or RPC endpoints.
- Reuse operator bridge and NativePlayerSession; no second transaction,
  signature, journal, token or reward implementation in the web server.
- Bind loopback only. Require exact Host, same-origin JSON POST and bounded
  bodies; reject cross-site/opaque origins and unknown native actions. No CORS.
- GET config returns only public/redacted metadata; exceptions must not expose
  private state paths, RPC query credentials, keys or stack traces.
- Standard wallet network names are mapped from the full pinned genesis for
  known mainnet, or explicitly local fixture. Unknown wallet network disables
  browser signing instead of silently selecting mainnet.
- Prepare/inspect/simulate/status/refresh/cancel preparation do not send. Only
  explicit broadcast accepts an already signed exact prepared message; it
  retains the existing durable journal and actual finalized result semantics.
- Test disabled defaults, configured dispatch, Host/Origin/JSON/body/route
  rejection, error redaction and explicit startup-file shape. Browser wallet
  signing and real network deployment remain separate acceptance scopes.
