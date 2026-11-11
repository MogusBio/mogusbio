import test from 'node:test';
import assert from 'node:assert/strict';
import {devnetOptions} from '../apps/devnet/cli.mjs';
import {assertSbfBuildDiagnostics} from '../apps/devnet/build.mjs';
test('Devnet operator commands require an explicit absolute deployment directory and deployment spending cap',()=>{
  const defaults=devnetOptions(['quote','--directory','/tmp/biolab-devnet']);assert.equal(defaults.endpoint,'https://api.devnet.solana.com');assert.equal(defaults.maxTransitions,64);assert.equal(defaults.maxSpendLamports,null);
  assert.throws(()=>devnetOptions(['deploy','--directory','/tmp/biolab-devnet']),/SPEND_REQUIRED/);
  assert.equal(devnetOptions(['deploy','--directory','/tmp/biolab-devnet','--max-spend-lamports','6000000000']).maxSpendLamports,6000000000n);
  for(const args of [['mint','--directory','/tmp/x'],['quote','--directory','relative'],['quote','--directory','/tmp/x','--player-key','/tmp/key'],['seed','--directory','/tmp/x','--max-transitions','1025'],['prepare','--directory','/tmp/x','--seed-delay-seconds','0'],['quote','--directory','/tmp/x','--directory','/tmp/y']])assert.throws(()=>devnetOptions(args));
});


test('SBF diagnostics reject all three real stack overflow formats even when cargo prints Finished and exits zero',()=>{
  const finished='    Finished `release` profile [optimized] target(s) in 1m 47s\n';
  for(const diagnostic of [
    'Error: Stack offset of 4752 exceeded max offset of 4096 by 656 bytes, please minimize large stack variables. Estimated function frame size: 4752 bytes. Exceeding the maximum stack offset may cause undefined behavior during execution.',
    'Error: Function _ZN14biolab_economy10synthesis8finalize overflows the maximum allowed frame space of 4096 bytes. Estimated function frame size: 5312 bytes. Exceeding the maximum stack offset may cause undefined behavior during execution.',
    'Error: stack frame size of 5312 bytes exceeds limit of 4096 bytes in function biolab_economy::synthesis::finalize',
  ])assert.throws(()=>assertSbfBuildDiagnostics(diagnostic+'\n'+finished),/DEVNET_BUILD_STACK_OVERFLOW/);
  assert.throws(()=>assertSbfBuildDiagnostics('\u001b[31mError:\u001b[0m Function example overflows the maximum allowed frame space of 4096 bytes.\n'+finished),/DEVNET_BUILD_STACK_OVERFLOW/);
});

test('SBF diagnostics reject ordinary compiler and linker Error lines without confusing source snippets or warnings',()=>{
  for(const diagnostic of ['Error: failed to verify ELF relocation','error: could not compile `biolab-economy` (lib) due to 1 previous error','error[E0432]: unresolved import `crate::missing`','LLVM ERROR: Cannot select instruction'])assert.throws(()=>assertSbfBuildDiagnostics(diagnostic),/DEVNET_BUILD_DIAGNOSTIC_ERROR/);
  assert.doesNotThrow(()=>assertSbfBuildDiagnostics('warning: unused import: `ProgramError`\n  20 | fn error_message() {}\nwarning: `biolab-economy` (lib) generated 18 warnings (run `cargo fix --lib -p biolab-economy` to apply 1 suggestion)\n    Finished `release` profile [optimized] target(s) in 1m 47s\n'));
  assert.doesNotThrow(()=>assertSbfBuildDiagnostics(''));
  assert.throws(()=>assertSbfBuildDiagnostics(null),/DEVNET_BUILD_DIAGNOSTICS/);
});
