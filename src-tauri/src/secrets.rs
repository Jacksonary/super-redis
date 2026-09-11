//! Credential storage.
//!
//! One AES-256-GCM master key lives in the OS keyring; every credential is held
//! in a single encrypted file (`secrets.enc`) beside `config.json`.
//!
//! The previous layout gave each credential its own keyring entry. On macOS the
//! `keyring` crate talks to the legacy file-based keychain, where every entry
//! carries an ACL checked against the caller's code signature — so an unsigned
//! or ad-hoc-signed build gets an authorization prompt *per entry, per access*,
//! and "Always Allow" never sticks because the signature changes every build.
//! Operations that never look at a password (renaming a group, drag-and-drop)
//! were still paying that cost for every connection.
//!
//! With one entry, cached for the process lifetime, the keychain is touched at
//! most once per run — and only when a credential is genuinely needed. This is
//! the same shape as Chromium/Electron `safeStorage`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};

const KEYRING_SERVICE: &str = "super-redis";
const MASTER_KEY_ACCOUNT: &str = "master-key";
const KEY_LEN: usize = 32;

/// Credential key (`{connection_id}:{field}`) → plaintext secret.
pub type SecretMap = HashMap<String, String>;

// ─── Master key ──────────────────────────────────────────────────────────────

static MASTER_KEY: OnceLock<Mutex<Option<[u8; KEY_LEN]>>> = OnceLock::new();
fn master_key_cell() -> &'static Mutex<Option<[u8; KEY_LEN]>> {
    MASTER_KEY.get_or_init(|| Mutex::new(None))
}

/// The master key, generated and persisted on first use.
///
/// This is the only place in the app that touches the OS keyring, and the value
/// is cached for the process lifetime, so a macOS build shows at most one
/// authorization prompt per run.
fn master_key() -> Result<[u8; KEY_LEN], String> {
    let mut cell = master_key_cell().lock().unwrap();
    if let Some(k) = *cell {
        return Ok(k);
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, MASTER_KEY_ACCOUNT)
        .map_err(|e| format!("keyring: {e}"))?;
    let key = match entry.get_password() {
        Ok(encoded) => decode_key(&encoded)?,
        // Only a genuinely absent entry may mint a new key. Any other error
        // (notably the user dismissing the macOS prompt) must propagate:
        // overwriting the key here would strand every stored credential.
        Err(keyring::Error::NoEntry) => {
            let mut k = [0u8; KEY_LEN];
            SystemRandom::new()
                .fill(&mut k)
                .map_err(|_| "failed to generate master key".to_string())?;
            entry
                .set_password(&base64::engine::general_purpose::STANDARD.encode(k))
                .map_err(|e| format!("keyring store: {e}"))?;
            k
        }
        Err(e) => return Err(format!("keyring load: {e}")),
    };
    *cell = Some(key);
    Ok(key)
}

fn decode_key(encoded: &str) -> Result<[u8; KEY_LEN], String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("master key is not valid base64: {e}"))?;
    raw.as_slice()
        .try_into()
        .map_err(|_| format!("master key must be {KEY_LEN} bytes, got {}", raw.len()))
}

// ─── Encryption ──────────────────────────────────────────────────────────────

/// Encrypt to `nonce || ciphertext || tag`. A fresh random nonce per write.
fn seal(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let unbound =
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "invalid master key".to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "failed to generate nonce".to_string())?;
    let mut buf = plaintext.to_vec();
    LessSafeKey::new(unbound)
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::empty(),
            &mut buf,
        )
        .map_err(|_| "failed to encrypt secrets".to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&buf);
    Ok(out)
}

fn unseal(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() <= NONCE_LEN {
        return Err("secrets file is truncated".to_string());
    }
    let (nonce, rest) = blob.split_at(NONCE_LEN);
    let nonce =
        Nonce::try_assume_unique_for_key(nonce).map_err(|_| "invalid nonce".to_string())?;
    let unbound =
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "invalid master key".to_string())?;
    let mut buf = rest.to_vec();
    let plain = LessSafeKey::new(unbound)
        .open_in_place(nonce, Aad::empty(), &mut buf)
        .map_err(|_| "failed to decrypt secrets (wrong master key?)".to_string())?;
    Ok(plain.to_vec())
}

// ─── Storage ─────────────────────────────────────────────────────────────────

fn secrets_path() -> PathBuf {
    crate::redisclient::config_dir().join("secrets.enc")
}

static SECRETS: OnceLock<Mutex<Option<SecretMap>>> = OnceLock::new();
fn secrets_cell() -> &'static Mutex<Option<SecretMap>> {
    SECRETS.get_or_init(|| Mutex::new(None))
}

fn read_from_disk() -> Result<SecretMap, String> {
    let path = secrets_path();
    if !path.exists() {
        return Ok(SecretMap::new());
    }
    let blob = std::fs::read(&path).map_err(|e| format!("Failed to read secrets: {e}"))?;
    if blob.is_empty() {
        return Ok(SecretMap::new());
    }
    let plain = unseal(&master_key()?, &blob)?;
    serde_json::from_slice(&plain).map_err(|e| format!("Failed to parse secrets: {e}"))
}

// ─── Plaintext key index ─────────────────────────────────────────────────────

fn index_path() -> PathBuf {
    crate::redisclient::config_dir().join("secrets_index.json")
}

static INDEX: OnceLock<Mutex<Option<Vec<String>>>> = OnceLock::new();
fn index_cell() -> &'static Mutex<Option<Vec<String>>> {
    INDEX.get_or_init(|| Mutex::new(None))
}

/// The key names present in `secrets.enc` — names only, never values.
///
/// This exists so the UI can say "a password is stored" without decrypting
/// anything, which is what keeps opening the edit dialog free of keychain
/// prompts. Holding only key names, it is safe to keep in plaintext.
pub fn index() -> Vec<String> {
    if let Some(v) = index_cell().lock().unwrap().as_ref() {
        return v.clone();
    }
    let v = std::fs::read(index_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default();
    *index_cell().lock().unwrap() = Some(v.clone());
    v
}

/// Is a credential stored under this key? Needs no master key.
pub fn has(key: &str) -> bool {
    index().iter().any(|k| k == key)
}

/// Rebuild the index from a decrypted map. Best-effort: a failure here costs the
/// UI a hint, never a credential.
fn write_index(map: &SecretMap) {
    let mut keys: Vec<String> = map.keys().cloned().collect();
    keys.sort();
    if let Ok(json) = serde_json::to_vec_pretty(&keys) {
        let path = index_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, json);
    }
    *index_cell().lock().unwrap() = Some(keys);
}

// ─── Reads and writes ────────────────────────────────────────────────────────

/// Every stored credential. Decrypted once, then served from memory.
pub fn get_all() -> Result<SecretMap, String> {
    migrate_legacy()?;
    if let Some(m) = secrets_cell().lock().unwrap().as_ref() {
        return Ok(m.clone());
    }
    let map = read_from_disk()?;
    // Self-healing: an install migrated by an earlier build has no index yet.
    write_index(&map);
    *secrets_cell().lock().unwrap() = Some(map.clone());
    Ok(map)
}

/// Read one credential.
pub fn get_one(key: &str) -> Result<Option<String>, String> {
    Ok(get_all()?.get(key).cloned())
}

/// Set (`Some`) or clear (`None` / empty) one credential, leaving every other
/// entry untouched.
///
/// The point of the narrow signature: a caller changing one password must not
/// have to hand over — or even know — the others.
pub fn set_one(key: &str, value: Option<&str>) -> Result<(), String> {
    let mut map = get_all()?;
    match value {
        Some(v) if !v.is_empty() => map.insert(key.to_string(), v.to_string()),
        _ => map.remove(key),
    };
    save_all(map)
}


/// Persist the full credential set, skipping the write when nothing changed.
///
/// The comparison is against the in-memory copy, never against the keychain —
/// checking by reading the stored value back is what made the old code prompt
/// even when it had nothing to save.
pub fn save_all(map: SecretMap) -> Result<(), String> {
    if secrets_cell().lock().unwrap().as_ref() == Some(&map) {
        return Ok(());
    }
    let blob = {
        let plain =
            serde_json::to_vec(&map).map_err(|e| format!("Failed to serialize secrets: {e}"))?;
        seal(&master_key()?, &plain)?
    };
    let path = secrets_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    std::fs::write(&path, &blob).map_err(|e| format!("Failed to write secrets: {e}"))?;
    write_index(&map);
    *secrets_cell().lock().unwrap() = Some(map);
    Ok(())
}

/// Drop every credential belonging to the given connections.
///
/// Takes a slice rather than one id so deleting a group costs a single
/// decrypt-and-rewrite instead of one per connection.
pub fn remove_for_connections(conn_ids: &[String]) -> Result<(), String> {
    if conn_ids.is_empty() {
        return Ok(());
    }
    let mut map = get_all()?;
    let before = map.len();
    map.retain(|k, _| !conn_ids.iter().any(|id| id == owner_id(k)));
    if map.len() != before {
        save_all(map)?;
    }
    Ok(())
}

/// The connection id a credential key belongs to. Keys are `{uuid}:{field}` and
/// a uuid never contains a colon, so the first segment is the owner.
pub fn owner_id(key: &str) -> &str {
    key.split(':').next().unwrap_or(key)
}

// ─── Migration off the legacy per-secret keyring layout ──────────────────────

/// Connection ids observed in `config.json`. Recorded during a metadata load
/// (which must not touch the keyring) so the migration below — which runs
/// lazily, the first time a credential is actually needed — knows which legacy
/// entries to look for. The `keyring` crate cannot enumerate entries.
static LEGACY_IDS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
fn legacy_ids() -> &'static Mutex<Vec<String>> {
    LEGACY_IDS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Cheap; does not touch the keyring.
pub fn note_connection_ids(ids: &[String]) {
    *legacy_ids().lock().unwrap() = ids.to_vec();
}

const LEGACY_FIELDS: [&str; 4] = [
    "acl_password",
    "tls_passphrase",
    "sentinel_password",
    "ssh_password",
];

static MIGRATED: OnceLock<Mutex<bool>> = OnceLock::new();

/// Move credentials from the old one-entry-per-secret layout into `secrets.enc`.
///
/// Runs at most once per process, and only when `secrets.enc` is absent and
/// there is something to migrate. This is the one unavoidable burst of macOS
/// prompts: reading each legacy entry needs its own ACL grant. Afterwards the
/// keychain is touched at most once per run.
///
/// Best-effort by design — an entry that fails to read (for instance because the
/// user dismissed its prompt) is left in place rather than dropped, so nothing
/// is lost and the next run can pick it up.
fn migrate_legacy() -> Result<(), String> {
    let mut done = MIGRATED.get_or_init(|| Mutex::new(false)).lock().unwrap();
    if *done {
        return Ok(());
    }
    *done = true;

    if secrets_path().exists() {
        return Ok(());
    }
    let ids = legacy_ids().lock().unwrap().clone();
    if ids.is_empty() {
        // Fresh install: nothing to migrate, and no reason to mint a master key
        // yet. Leaving the file absent keeps startup free of keychain access.
        return Ok(());
    }

    let mut map = SecretMap::new();
    let mut recovered: Vec<String> = Vec::new();
    for id in &ids {
        for field in LEGACY_FIELDS {
            let key = format!("{id}:{field}");
            let entry = match keyring::Entry::new(KEYRING_SERVICE, &key) {
                Ok(e) => e,
                Err(_) => continue,
            };
            match entry.get_password() {
                Ok(v) if !v.is_empty() => {
                    map.insert(key.clone(), v);
                    recovered.push(key);
                }
                _ => {}
            }
        }
    }

    if map.is_empty() {
        return Ok(());
    }
    // The legacy entries are deliberately left in place. Deleting a keychain item
    // needs its own authorization prompt, so cleaning up would double the
    // migration's prompt count to tidy data that is already inert — nothing reads
    // those entries again. They can be removed by hand in Keychain Access.
    let _ = recovered;
    save_all(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; KEY_LEN] {
        [7u8; KEY_LEN]
    }

    #[test]
    fn seal_then_unseal_roundtrips() {
        let plain = br#"{"abc:acl_password":"hunter2"}"#;
        let blob = seal(&key(), plain).unwrap();
        assert_eq!(unseal(&key(), &blob).unwrap(), plain);
    }

    #[test]
    fn nonce_is_fresh_so_ciphertext_is_not_deterministic() {
        // Chromium's safeStorage hardcodes its IV, which makes equal plaintexts
        // produce equal ciphertexts. Ours must not.
        let a = seal(&key(), b"same").unwrap();
        let b = seal(&key(), b"same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn wrong_key_fails_instead_of_returning_garbage() {
        let blob = seal(&key(), b"secret").unwrap();
        assert!(unseal(&[9u8; KEY_LEN], &blob).is_err());
    }

    #[test]
    fn tampering_is_detected() {
        let mut blob = seal(&key(), b"secret").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xff;
        assert!(unseal(&key(), &blob).is_err());
    }

    #[test]
    fn truncated_blob_is_rejected() {
        assert!(unseal(&key(), &[0u8; NONCE_LEN]).is_err());
        assert!(unseal(&key(), b"").is_err());
    }

    #[test]
    fn master_key_encoding_roundtrips() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(key());
        assert_eq!(decode_key(&encoded).unwrap(), key());
    }

    #[test]
    fn short_master_key_is_rejected() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1u8; 16]);
        assert!(decode_key(&encoded).is_err());
    }

    #[test]
    fn owner_id_splits_on_the_field_suffix() {
        let id = "3f2a1b4c-0000-4000-8000-000000000001";
        assert_eq!(owner_id(&format!("{id}:acl_password")), id);
        assert_eq!(owner_id(&format!("{id}:tls_passphrase")), id);
        // Defensive: a key with no suffix still yields something sane.
        assert_eq!(owner_id(id), id);
    }
}
