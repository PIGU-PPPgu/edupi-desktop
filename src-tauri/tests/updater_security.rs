#![cfg(target_os = "macos")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use tauri_plugin_updater::{Config, Error, Update, UpdaterExt};

// Public, throwaway upstream vectors: payload "test", signed version 2.0.0.
// No private signing key, filesystem installation, or network is used here.
const PUBLIC_KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";

fn update(version: &str, signature: &str) -> Update {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({ "pubkey": STANDARD.encode(PUBLIC_KEY) }),
    );
    let app = tauri::test::mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(STANDARD.encode(PUBLIC_KEY))
                .build(),
        )
        .build(context)
        .unwrap();
    app.updater_builder()
        .target("security-test")
        .executable_path("unused-updater-security/app")
        .no_proxy()
        .endpoints(vec!["https://example.invalid/update".parse().unwrap()])
        .unwrap()
        .configure_client(|_| panic!("updater security test must not make network requests"))
        .build()
        .unwrap()
        .restore_update(json!({
            "version": version,
            "platforms": { "security-test": {
                "url": "https://example.invalid/package",
                "signature": STANDARD.encode(signature)
            }}
        }))
        .unwrap()
        .unwrap()
}

#[test]
fn valid_package_verifies_without_installing() {
    update("2.0.0", SIGNATURE).verify(b"test").unwrap();
}

#[test]
fn tampered_bytes_are_rejected_at_the_install_entry_before_filesystem_access() {
    let update = update("2.0.0", SIGNATURE);
    assert!(matches!(
        update.verify(b"tampered"),
        Err(Error::Minisign(_))
    ));
    // An IO/archive/authorization error would mean verification did not stop install.
    assert!(matches!(
        update.install(b"tampered"),
        Err(Error::Minisign(_))
    ));
}

#[test]
fn signed_version_mismatch_stops_install_before_filesystem_access() {
    let update = update("9.9.9", SIGNATURE);
    assert!(matches!(
        update.install(b"test"),
        Err(Error::SignedVersionMismatch { .. })
    ));
}

#[test]
fn tampered_trusted_comment_is_not_accepted_as_a_version() {
    let signature = SIGNATURE.replace("version:2.0.0", "version:9.9.9");
    assert!(matches!(
        update("9.9.9", &signature).verify(b"test"),
        Err(Error::Minisign(_))
    ));
}

#[test]
fn noncanonical_global_signature_stays_rejected() {
    // Existing minisign-verify 0.2.5 already rejects this; retain the protection
    // through the updater migration instead of claiming it as a newly fixed bug.
    const ORDER: [u8; 32] = [
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde,
        0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ];
    let mut lines: Vec<_> = SIGNATURE.lines().map(str::to_owned).collect();
    let mut global = STANDARD.decode(&lines[3]).unwrap();
    let mut carry = 0u16;
    for (value, order) in global[32..].iter_mut().zip(ORDER) {
        let sum = u16::from(*value) + u16::from(order) + carry;
        *value = sum as u8;
        carry = sum >> 8;
    }
    assert_eq!(carry, 0);
    lines[3] = STANDARD.encode(global);
    assert!(matches!(
        update("2.0.0", &lines.join("\n")).verify(b"test"),
        Err(Error::Minisign(_))
    ));
}

#[test]
fn production_configuration_keeps_transport_and_downgrade_guards() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let config: Config = serde_json::from_value(value["plugins"]["updater"].clone()).unwrap();
    assert!(!config.allow_downgrades);
    assert!(!config.require_signed_version);
    assert!(!config.dangerous_insecure_transport_protocol);
    assert!(!config.dangerous_accept_invalid_certs);
    assert!(!config.dangerous_accept_invalid_hostnames);
    assert!(config.endpoints.iter().all(|url| url.scheme() == "https"));
}
