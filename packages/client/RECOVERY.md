# Recovering a pending native request

Recovery is an explicit, separately signed competing request. It uses the
existing SYNC_EMISSION operation at the original actor nonce. It does not undo
an already executed operation, revoke an external signature or modify the old
request. The native nonce permits at most one of the competing Frames to run.

Create two `NativePlayerSession` instances for the same actor and release, with
different durable journal directories. Keep the primary directory and original
unsigned/signed envelope. The cancellation directory preserves the second
Frame and its own attempts and eventual result.

```js
const prepared = await prepareNativeCancellation({
  release, abi, actor, primarySession, cancellationSession,
  nonce, maxRent, resources
});
// Export prepared.envelope. A wallet must separately review and sign it.
// Only an explicit cancellationSession.broadcastSigned(envelope, signedBytes)
// submits that signed request.
const status = await reconcileNativeCancellation({
  release, abi, actor, primarySession, cancellationSession, nonce
});
```

`ORIGINAL_CONFIRMED` means a matching finalized result confirms the original
Frame. `CANCEL_CONFIRMED` means a matching finalized result confirms the SYNC
Frame; it also proves the original Frame cannot execute at that nonce.
`CANCELLATION_PENDING` means neither is confirmed and the nonce remains open.
`UNKNOWN` means the available facts cannot establish which request executed.
The returned primary/cancellation records retain their own precise statuses.

If nonce n+2 is already current and neither result was retained before the
single latest-result cache was overwritten, ALREADY_PROCESSED proves only that
nonce n is no longer open. It does not establish whether either submitted Frame
ran, and it cannot recover a result. A previously retained local confirmation
does remain usable after that overwrite.

A timeout may have happened after a leader received the packet. Reconcile
before retrying. `cancellationSession.refresh(prepared.envelope)` replaces the
blockhash while retaining the exact cancellation Frame and nonce; the refreshed
message requires a fresh wallet signature. Do not renumber the old request.

SYNC can update the existing emissions ledger as specified by that native
operation. It introduces no recovery economic fee; transaction fees and actual
rent requirements remain the ordinary Solana costs of the selected request.
The helper prepares data and local recovery records only. It never signs,
broadcasts, claims that unknown signatures expired or invents a cancellation
success from a Boolean.

The independent local acceptance uses two actual POSIX FileJournalStores and
passes8/8 tests. It covers either request winning, an overwritten nonce cache
remaining unknown, mismatched identities and shared namespaces, complete public
fixture signatures, transport timeout, reopening both journals and retrying a
new blockhash with the unchanged cancellation Frame. The native Bank race test
is a separate acceptance gate. No actual network submission occurs in these
client tests.

The two finalized reads can straddle execution. If the second read proves a
consumed nonce while the first side still appears pending, recovery rereads the
earlier side. A still lagging RPC leaves the aggregate UNKNOWN; it must not
report an open pending nonce after the other side already proved that nonce
was consumed.
