//! Only public release data enters the program. No generated/development key.
use std::{env,fs,path::PathBuf,process::Command};
fn main(){
 println!("cargo:rerun-if-env-changed=BIO_RELEASE_MANIFEST");
 let acceptance=env::var_os("CARGO_FEATURE_ACCEPTANCE_TEST").is_some();
 let production=env::var_os("CARGO_FEATURE_PRODUCTION_ADMISSION").is_some();
 assert!(acceptance!=production,"select exactly one release profile: acceptance-test OR production-admission; production requires --no-default-features");
 if !production{return;}
 assert!(env::var_os("CARGO_FEATURE_HISTORICAL_OPENING14").is_none(),"historical opening can never be a production release");
 let input=PathBuf::from(env::var_os("BIO_RELEASE_MANIFEST").expect("production requires an approved public BIO_RELEASE_MANIFEST; no test defaults"));
 assert!(input.is_absolute()&&input.is_file(),"BIO_RELEASE_MANIFEST must be an existing absolute public JSON file");
 println!("cargo:rerun-if-changed={}",input.display());
 let script=PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../packages/client/src/release.mjs");
 println!("cargo:rerun-if-changed={}",script.display());
 let project=PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
 println!("cargo:rerun-if-changed={}",project.join("operations.p0r2.json").display());
 println!("cargo:rerun-if-changed={}",project.join("operations.market1.json").display());
 println!("cargo:rerun-if-changed={}",project.join("../../packages").display());
 println!("cargo:rerun-if-changed={}",project.join("../../releases/func2r2/manifest.json").display());
 let local=env::var_os("CARGO_FEATURE_LOCAL_PUBLIC_FIXTURE").is_some();
 let mut command=Command::new("node");command.arg(&script).arg("emit-rust").arg(&input);if local{command.arg("--local-public-fixture");}
 let output=command.output().expect("Node public-release validator must run");
 assert!(output.status.success(),"production release validation failed: {}",String::from_utf8_lossy(&output.stderr));
 let text=String::from_utf8(output.stdout).expect("release compiler output UTF8");
 assert!(text.starts_with("// Generated from validated public BIOP0R2 input."),"unexpected release compiler output");
 assert!(text.contains(&format!("pub const IS_LOCAL_PUBLIC_FIXTURE: bool = {local};")),"public fixture mode must match explicit compile profile");
 fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("production_release.rs"),text).unwrap();
}
