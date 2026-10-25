#![cfg(unix)]

// Real-library regressions for RUSTSEC-2026-0367, -0368, and -0369.
// The updater uses ZipArchive::extract on Windows. The stream cases separately
// protect the library API; they do not claim to exercise the Windows updater.
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{Cursor, Write};
use std::os::unix::fs::{symlink, DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use zip::unstable::stream::ZipStreamReader;
use zip::{CompressionMethod, ZipArchive};

const REGULAR: u32 = 0o100000;
const SYMLINK: u32 = 0o120000;
const VICTIM_CONTENT: &[u8] = b"isolated ZIP security sentinel\n";

// Preserve every archive and extraction result, including failures. There is no
// TempDir or Drop cleanup: each process gets a fresh, private, printed root.
fn fixture(case: &str) -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    let root = ROOT.get_or_init(|| {
        let parent = std::env::var_os("EDUPI_ZIP_SECURITY_FIXTURE_PARENT")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = parent.join(format!("edupi-zip-security-{}-{nonce}", std::process::id()));
        private_dir(&root);
        root
    });
    let path = root.join(case);
    private_dir(&path);
    println!("fixture={}", path.display());
    path
}

fn private_dir(path: &Path) {
    DirBuilder::new().mode(0o700).create(path).unwrap();
}

fn write_new(path: &Path, contents: &[u8]) {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(contents).unwrap();
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o7777
}

struct StoredEntry<'a> {
    local_name: &'a str,
    central_name: &'a str,
    contents: &'a [u8],
    unix_mode: u32,
}

impl<'a> StoredEntry<'a> {
    fn matching(name: &'a str, contents: &'a [u8], unix_mode: u32) -> Self {
        Self { local_name: name, central_name: name, contents, unix_mode }
    }
}

// Write the small Stored ZIP format directly. ZipWriter::unix_permissions masks
// special bits before they reach the reader, which would erase the 0367 attack.
fn stored_zip(entries: &[StoredEntry<'_>], extra_central_magic: bool) -> Vec<u8> {
    fn u16le(bytes: &mut Vec<u8>, value: u16) { bytes.extend(value.to_le_bytes()); }
    fn u32le(bytes: &mut Vec<u8>, value: u32) { bytes.extend(value.to_le_bytes()); }
    fn crc32(contents: &[u8]) -> u32 {
        let mut crc = !0u32;
        for byte in contents {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        !crc
    }

    let mut bytes = Vec::new();
    let mut offsets = Vec::new();
    for entry in entries {
        offsets.push(u32::try_from(bytes.len()).unwrap());
        u32le(&mut bytes, 0x04034b50);
        for value in [20, 0, 0, 0, 33] { u16le(&mut bytes, value); }
        u32le(&mut bytes, crc32(entry.contents));
        let length = u32::try_from(entry.contents.len()).unwrap();
        u32le(&mut bytes, length);
        u32le(&mut bytes, length);
        u16le(&mut bytes, u16::try_from(entry.local_name.len()).unwrap());
        u16le(&mut bytes, 0);
        bytes.extend(entry.local_name.as_bytes());
        bytes.extend(entry.contents);
    }
    // zip 4.6.1 consumes the first central signature before parsing metadata.
    // Preserve both an ordinary archive and this four-byte gap variant, whose
    // real central directory is still correctly located by its EOCD offset.
    if extra_central_magic { u32le(&mut bytes, 0x02014b50); }
    let central_start = u32::try_from(bytes.len()).unwrap();
    for (entry, offset) in entries.iter().zip(offsets) {
        u32le(&mut bytes, 0x02014b50);
        // "Made by Unix" is necessary for the external attributes to be a mode.
        for value in [(3 << 8) | 20, 20, 0, 0, 0, 33] { u16le(&mut bytes, value); }
        u32le(&mut bytes, crc32(entry.contents));
        let length = u32::try_from(entry.contents.len()).unwrap();
        u32le(&mut bytes, length);
        u32le(&mut bytes, length);
        u16le(&mut bytes, u16::try_from(entry.central_name.len()).unwrap());
        for _ in 0..4 { u16le(&mut bytes, 0); }
        u32le(&mut bytes, entry.unix_mode << 16);
        u32le(&mut bytes, offset);
        bytes.extend(entry.central_name.as_bytes());
    }
    let central_length = u32::try_from(bytes.len()).unwrap() - central_start;
    u32le(&mut bytes, 0x06054b50);
    u16le(&mut bytes, 0);
    u16le(&mut bytes, 0);
    let count = u16::try_from(entries.len()).unwrap();
    u16le(&mut bytes, count);
    u16le(&mut bytes, count);
    u32le(&mut bytes, central_length);
    u32le(&mut bytes, central_start);
    u16le(&mut bytes, 0);
    bytes
}

#[test]
fn archive_extract_strips_privileged_permission_bits() {
    let root = fixture("0367-special-permissions");
    let contents = b"synthetic regular file, never executed\n";
    let bytes = stored_zip(&[StoredEntry::matching("payload", contents, REGULAR | 0o6755)], false);
    write_new(&root.join("special-permissions.zip"), &bytes);
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert_eq!(archive.by_index(0).unwrap().compression(), CompressionMethod::Stored);
    let out = root.join("out");
    archive.extract(&out).unwrap();
    let payload = out.join("payload");
    let observed = mode(&payload);
    println!("0367 requested=06755 observed={observed:05o}");
    assert_eq!(fs::read(&payload).unwrap(), contents);
    assert_eq!(observed & 0o777, 0o755);
    assert_eq!(observed & 0o7000, 0, "archive special bits must not survive extraction");
}

#[test]
fn archive_extract_rejects_symlink_target_outside_destination() {
    let root = fixture("0368-symlink-escape");
    let out = root.join("out");
    let outside = root.join("outside");
    private_dir(&out);
    private_dir(&outside);
    let victim = outside.join("victim");
    write_new(&victim, VICTIM_CONTENT);
    assert_eq!(mode(&victim), 0o600);
    let bytes = stored_zip(&[StoredEntry::matching("escape", b"../outside/victim", SYMLINK | 0o777)], false);
    write_new(&root.join("symlink-escape.zip"), &bytes);
    let result = ZipArchive::new(Cursor::new(bytes)).unwrap().extract(&out);
    let link = fs::symlink_metadata(out.join("escape")).ok();
    let victim_mode = mode(&victim);
    println!("0368 result={result:?} escaped_link_created={} victim_mode={victim_mode:04o}", link.is_some());
    assert_eq!(fs::read(&victim).unwrap(), VICTIM_CONTENT);
    assert_eq!(victim_mode, 0o600);
    assert!(link.is_none(), "an escaping symlink must never be created");
    assert!(result.is_err(), "escaping symlink extraction must be rejected");
}

#[test]
fn archive_extract_keeps_internal_symlinks_and_stored_installer_bytes() {
    let root = fixture("stored-controls");
    let lesson = b"synthetic lesson bytes\n";
    let installer = b"synthetic installer text; never execute\n";
    let bytes = stored_zip(&[
        StoredEntry::matching("payload/lesson.txt", lesson, REGULAR | 0o644),
        StoredEntry::matching("lesson-link", b"payload/lesson.txt", SYMLINK | 0o777),
        StoredEntry::matching("Stored.exe", installer, REGULAR | 0o644),
        StoredEntry::matching("Stored.msi", installer, REGULAR | 0o644),
    ], false);
    write_new(&root.join("stored-controls.zip"), &bytes);
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    for index in 0..archive.len() {
        assert_eq!(archive.by_index(index).unwrap().compression(), CompressionMethod::Stored);
    }
    let out = root.join("out");
    archive.extract(&out).unwrap();
    let link = out.join("lesson-link");
    assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
    assert_eq!(fs::read_link(&link).unwrap(), Path::new("payload/lesson.txt"));
    assert!(link.canonicalize().unwrap().starts_with(out.canonicalize().unwrap()));
    assert_eq!(fs::read(&link).unwrap(), lesson);
    for name in ["Stored.exe", "Stored.msi"] {
        let path = out.join(name);
        assert_eq!(fs::read(&path).unwrap(), installer);
        assert_eq!(mode(&path), 0o644);
    }
}

fn assert_stream_metadata_does_not_chmod_unwritten_symlink(extra_central_magic: bool) {
    let case = if extra_central_magic { "0369-extra-central-magic" } else { "0369-ordinary" };
    let root = fixture(case);
    let out = root.join("out");
    let outside = root.join("outside");
    private_dir(&out);
    private_dir(&outside);
    let victim = outside.join("victim");
    write_new(&victim, VICTIM_CONTENT);
    assert_eq!(mode(&victim), 0o600);
    let link = out.join("e.txt");
    symlink("../outside/victim", &link).unwrap();
    let contents = b"local-header payload\n";
    let bytes = stored_zip(&[StoredEntry {
        local_name: "f.txt", central_name: "e.txt", contents, unix_mode: REGULAR | 0o777,
    }], extra_central_magic);
    write_new(&root.join("mismatched-metadata.zip"), &bytes);
    let result = ZipStreamReader::new(Cursor::new(bytes)).extract(&out);
    let victim_mode = mode(&victim);
    println!("0369 extra_central_magic={extra_central_magic} result={result:?} victim_mode={victim_mode:04o}");
    assert_eq!(fs::read(&victim).unwrap(), VICTIM_CONTENT);
    assert_eq!(victim_mode, 0o600, "central metadata must not chmod a file this extraction never wrote");
    assert_eq!(fs::read_link(&link).unwrap(), Path::new("../outside/victim"));
    if result.is_ok() {
        assert_eq!(fs::read(out.join("f.txt")).unwrap(), contents);
    }
}

#[test]
fn stream_extract_ignores_unwritten_central_name_permissions() {
    assert_stream_metadata_does_not_chmod_unwritten_symlink(false);
}

#[test]
fn stream_extract_ignores_unwritten_central_name_after_extra_central_magic() {
    assert_stream_metadata_does_not_chmod_unwritten_symlink(true);
}
