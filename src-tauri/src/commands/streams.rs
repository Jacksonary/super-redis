use crate::commands::util::{session, val_to_i64, val_to_string};
use crate::types::{StreamEntry, StreamGroup, StreamInfo};
use redis::Value;
use std::collections::HashMap;

/// Read stream entries in a range with `XRANGE`.
async fn xrange(
    s: &crate::redisclient::Session,
    db: i64,
    key: &str,
    start: &str,
    end: &str,
    count: i64,
) -> Result<Vec<StreamEntry>, String> {
    let v = s
        .query(
            db,
            vec!["XRANGE".to_string(), key.to_string(), start.to_string(), end.to_string(), "COUNT".to_string(), count.to_string()],
        )
        .await?;
    Ok(match v {
        Value::Array(list) => list
            .into_iter()
            .filter_map(|e| match e {
                Value::Array(pair) if pair.len() >= 2 => {
                    let id = val_to_string(&pair[0]);
                    let fields = match &pair[1] {
                        Value::Array(flat) => flat
                            .chunks(2)
                            .map(|c| (val_to_string(&c[0]), val_to_string(c.get(1).unwrap_or(&Value::Nil))))
                            .collect(),
                        _ => Vec::new(),
                    };
                    Some(StreamEntry { id, fields })
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

/// Best-effort parse of `XINFO GROUPS` (handles both RESP2 flat arrays and RESP3 maps).
fn parse_groups(v: &Value) -> Vec<StreamGroup> {
    let arr = match v {
        Value::Array(a) => a.clone(),
        _ => return Vec::new(),
    };
    arr.iter()
        .filter_map(|g| match g {
            Value::Map(m) => {
                let get_s = |k: &str| {
                    m.iter()
                        .find(|(kk, _)| val_to_string(kk) == k)
                        .map(|(_, vv)| val_to_string(vv))
                        .unwrap_or_default()
                };
                let get_i = |k: &str| m.iter().find(|(kk, _)| val_to_string(kk) == k).map(|(_, vv)| val_to_i64(vv)).unwrap_or(0);
                Some(StreamGroup {
                    name: get_s("name"),
                    consumers: get_i("consumers"),
                    pending: get_i("pending"),
                    last_delivered_id: get_s("last-delivered-id"),
                })
            }
            Value::Array(flat) => {
                let get_s = |k: &str| {
                    flat.chunks(2)
                        .find(|c| val_to_string(&c[0]) == k)
                        .map(|c| val_to_string(&c[1]))
                        .unwrap_or_default()
                };
                let get_i = |k: &str| {
                    flat.chunks(2)
                        .find(|c| val_to_string(&c[0]) == k)
                        .map(|c| val_to_i64(&c[1]))
                        .unwrap_or(0)
                };
                Some(StreamGroup {
                    name: get_s("name"),
                    consumers: get_i("consumers"),
                    pending: get_i("pending"),
                    last_delivered_id: get_s("last-delivered-id"),
                })
            }
            _ => None,
        })
        .collect()
}

#[tauri::command]
pub async fn get_stream_info(conn_id: String, db: i64, key: String) -> Result<StreamInfo, String> {
    let s = session(&conn_id).await?;
    let len = val_to_i64(&s.query(db, vec!["XLEN".to_string(), key.clone()]).await?);
    let entries = xrange(&s, db, &key, "-", "+", 100).await?;
    let groups = s
        .query(db, vec!["XINFO".to_string(), "GROUPS".to_string(), key.clone()])
        .await
        .ok()
        .map(|v| parse_groups(&v))
        .unwrap_or_default();
    Ok(StreamInfo { length: len, entries, groups, consumers: Vec::new() })
}

#[tauri::command]
pub async fn read_stream_entries(
    conn_id: String,
    db: i64,
    key: String,
    start: Option<String>,
    end: Option<String>,
    count: Option<i64>,
) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let start = start.unwrap_or_else(|| "-".into());
    let end = end.unwrap_or_else(|| "+".into());
    let count = count.unwrap_or(100).clamp(1, 1000);
    let entries = xrange(&s, db, &key, &start, &end, count).await?;
    Ok(serde_json::json!({ "entries": entries }))
}

#[tauri::command]
pub async fn add_stream_entry(conn_id: String, db: i64, key: String, fields: HashMap<String, String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["XADD".to_string(), key, "*".to_string()];
    for (k, v) in fields {
        args.push(k);
        args.push(v);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "id": val_to_string(&v) }))
}

#[tauri::command]
pub async fn delete_stream_entry(conn_id: String, db: i64, key: String, ids: Vec<String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["XDEL".to_string(), key];
    for id in ids {
        args.push(id);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "deleted": val_to_i64(&v) }))
}

#[tauri::command]
pub async fn create_consumer_group(conn_id: String, db: i64, key: String, group: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["XGROUP".to_string(), "CREATE".to_string(), key, group, "$".to_string(), "MKSTREAM".to_string()]).await?;
    Ok(serde_json::json!({ "ok": true }))
}
