# Public wallet login core — check before implementation

Scope: independent local message authentication and protected session storage.
No transaction signing, RPC, token authority, deployment or independent audit.

- [x] Trusted canonical HTTPS origin and admitted release/ABI/domain/config are
  constructor bindings. Explicit loopback tests are separate; Forwarded/Host
  headers and request-supplied clocks are never configuration authorities.
- [x] A wallet signs a UTF-8 message explicitly saying login, no transaction or
  asset authorization. Bind actor, origin, full release context, random32 nonce,
  challenge ID, issued and expiry; challenge TTL is at most five minutes.
- [x] Node crypto verifies the exact64-byte detached Ed25519 signature against
  the stored message. Challenge consumption and new session hash are one CAS;
  replay/concurrent attempts have one winner, including after process restart.
- [x] Random32-byte opaque session token is returned only as a Set-Cookie value;
  only its SHA-256 verifier is stored. Public session identity comes from the
  validated protected record, never from cookie fields or a requested actor.
- [x] Cookie is Path=/, HttpOnly, Secure, SameSite=Strict with no Domain;
  HTTPS uses __Host-biolab_session and explicit loopback uses biolab_session.
  Expiry, logout and explicit replacement are durable; no automatic renewal.
- [x] Protected600 FileCAS/700 directories, bounded challenges/sessions/rates,
  pruning, attempt limits and clock rollback rejection. Errors expose constants
  without messages, signatures, cookies, tokens, source snippets or paths.
- [x] Tests use only generated disposable/public fixture keys: origin/context
  binding, tampered signatures, expiry, replay/restart/concurrent winner,
  hash-only persistence, logout/replacement, bounds, modes and malformed files.

Gateway integration owns exact Host/Origin/CSRF/size/IP rate policy, HTTPS proxy
configuration and HTTP header emission. The caller must keep cookie values out
of response JSON/logs, bind every private action to authenticate().actor and use
one durable actor business namespace across browsers.

Implemented API: `createPublicAuth({release,abi,origin,stateDirectory,
allowLocalhost,clock,challengeTtlSeconds,sessionTtlSeconds,limits})` returns
`publicConfig`, `issueChallenge({actor})`,
`login({challengeId,signatureBase64,cookieHeader?})`,
`authenticate({cookieHeader})`, and `revoke({cookieHeader})`. The optional clock
is a trusted constructor test dependency. HTTP callers cannot choose time or
override context. Login returns `{cookie,publicSession}` and revoke returns
`{cookie,revoked:true}`; the gateway must emit the cookie only as Set-Cookie.

Defaults are120-second challenges,1800-second absolute sessions,512 pending/used
unexpired challenge records,4096 sessions,3 active challenges and8 sessions per
actor,120 issue calls/minute,6 issues/actor/minute,600 login calls/minute and5
signature attempts/challenge. All settings have finite hard bounds. An expired
or revoked token cannot reappear after restart. Wall-clock rollback rejects
authentication until the trusted clock catches the persisted high-water mark.
Existing FileCAS crash locks stay fail-closed and use its operator recovery
procedure; they are never reclaimed merely by age.

Local acceptance: `node --test packages/bridge/test/public-auth.test.mjs`
passes7/7; source and test syntax checks pass. Evidence:
`evidence/public-auth-current.log`. No real wallet key, environment file, RPC,
transaction, deployment or independent audit was used.

Primary references checked for the implementation:

- [Node crypto Ed25519 verify](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback)
- [MDN Set-Cookie attributes and __Host- requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [OWASP opaque session verifier storage](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
