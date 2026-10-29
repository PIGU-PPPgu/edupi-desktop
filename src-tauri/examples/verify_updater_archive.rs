use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, error::Error, fs, io};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err(io::Error::other("expected updater tar, signature and Tauri config paths").into());
    }
    let tar = fs::read(&args[1])?;
    let signature_base64 = fs::read_to_string(&args[2])?;
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&args[3])?)?;
    let public_base64 = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| io::Error::other("updater public key is missing"))?;
    let public_text = STANDARD.decode(public_base64.trim())?;
    let signature_text = STANDARD.decode(signature_base64.trim())?;
    let public_key = PublicKey::decode(std::str::from_utf8(&public_text)?)?;
    let signature = Signature::decode(std::str::from_utf8(&signature_text)?)?;
    public_key.verify(&tar, &signature, true)?;
    let mut tampered = tar;
    tampered[0] ^= 1;
    if public_key.verify(&tampered, &signature, true).is_ok() {
        return Err(io::Error::other("tampered updater archive was accepted").into());
    }
    println!("verified=true tamper_rejected=true");
    Ok(())
}
