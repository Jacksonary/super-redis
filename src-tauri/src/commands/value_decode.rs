use crate::commands::util::{session, val_to_string};
use base64::Engine;
use flate2::read::{GzDecoder, ZlibDecoder};
use redis::Value;
use std::io::Read;

fn decompress<R: Read>(mut r: R) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    r.read_to_end(&mut out).map_err(|e| format!("decompress: {e}"))?;
    Ok(out)
}

fn textify(bytes: &[u8]) -> (String, bool) {
    let is_binary = std::str::from_utf8(bytes).is_err();
    (String::from_utf8_lossy(bytes).into_owned(), is_binary)
}

/// Decode a string value into a chosen display format (text/json/hex/base64/
/// gzip/deflate/brotli/msgpack). The raw value is never mutated.
#[tauri::command]
pub async fn decode_value(
    conn_id: String,
    db: i64,
    key: String,
    format: String,
) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["GET".to_string(), key.clone()]).await?;
    let bytes = match v {
        Value::BulkString(b) => b,
        Value::Nil => return Ok(serde_json::json!({ "text": "(nil)", "is_binary": false })),
        other => return Ok(serde_json::json!({ "text": val_to_string(&other), "is_binary": false })),
    };
    let low = format.to_lowercase();
    let (text, is_binary) = match low.as_str() {
        "text" | "raw" => textify(&bytes),
        "hex" => (bytes.iter().map(|x| format!("{x:02x}")).collect::<String>(), true),
        "base64" => (base64::engine::general_purpose::STANDARD.encode(&bytes), true),
        "json" => {
            let s = std::str::from_utf8(&bytes)
                .map_err(|_| "value is not valid UTF-8, cannot parse as JSON".to_string())?;
            let parsed: serde_json::Value =
                serde_json::from_str(s).map_err(|_| "value is not valid JSON".to_string())?;
            (serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| s.to_string()), false)
        }
        "gzip" => textify(&decompress(GzDecoder::new(&bytes[..])).map_err(|e| format!("gzip: {e}"))?),
        "deflate" => textify(&decompress(ZlibDecoder::new(&bytes[..])).map_err(|e| format!("deflate: {e}"))?),
        "brotli" => textify(&decompress(brotli::Decompressor::new(&bytes[..], 4096)).map_err(|e| format!("brotli: {e}"))?),
        "msgpack" => {
            let val: serde_json::Value =
                rmp_serde::from_slice(&bytes).map_err(|e| format!("msgpack: {e}"))?;
            (val.to_string(), false)
        }
        other => return Err(format!("Unsupported format: {other}")),
    };
    Ok(serde_json::json!({ "text": text, "is_binary": is_binary }))
}
