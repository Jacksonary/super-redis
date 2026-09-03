[English](README.md) | [简体中文](README.zh-CN.md)

# Super Redis Desktop

A cross-platform Redis desktop client built with [Tauri 2](https://v2.tauri.app/) + Rust + React. Features reference [AnotherRedisDesktopManager](https://gitee.com/qishibo/AnotherRedisDesktopManager). Easy to use — just download and run.

**Repository**: [GitHub](https://github.com/Jacksonary/super-redis) | [Gitee](https://gitee.com/weiguoliu/super-redis)

## Features

### Connection Management
- Multiple connections with color tags, grouping, cloning, and connection testing
- Standalone / Redis Cluster / Redis Sentinel modes
- SSL/TLS (rediss), ACL user/password (Redis 6+)
- Read-only mode

### Key Browsing
- SCAN-based pagination that never blocks the server (no `KEYS`)
- Pattern search with history
- Batch delete / rename / TTL management
- In-database key count

### Value Viewers (per type)
- String (text / JSON auto-format)
- Hash (field/value table with add/edit/delete)
- List (paged, LPUSH/RPUSH, delete, edit)
- Set (members, add/remove)
- ZSet, Stream, RedisJSON (phase 1)

### Terminal
- Command console with history and pipeline execution
- Publish/subscribe message publishing

### Extras
- Light / dark theme, page zoom, Simplified Chinese / English i18n

## Download

Get installers from [GitHub Releases](https://github.com/Jacksonary/super-redis/releases) or [Gitee Releases](https://gitee.com/weiguoliu/super-redis/releases):

| Platform | Format |
|---|---|
| Windows 64-bit | `.exe` (NSIS) / `.msi` |
| Linux | `.deb` / `.rpm` / `.AppImage` |
| macOS (Apple Silicon) | `.dmg` |

> macOS builds are not code-signed/notarized; if Gatekeeper reports the app as "damaged", remove the quarantine attribute:
> ```bash
> xattr -cr "/Applications/Super Redis.app"
> ```

## Configuration

Connections are saved to the system application data directory; passwords are stored only in the OS keyring:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/super-redis/config.json` |
| Linux | `~/.config/super-redis/config.json` |
| Windows | `%APPDATA%\super-redis\config.json` |

## Building from Source

```bash
# Prerequisites: Rust, Node.js, Tauri system dependencies
# Linux: sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev
# Tauri CLI: npm i (devDependencies include @tauri-apps/cli)

git clone https://github.com/Jacksonary/super-redis.git
cd super-redis
npm install
npm run tauri dev
```

Build artifacts: `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Tauri 2 |
| Backend | Rust + redis-rs (async, cluster/sentinel/TLS) |
| Frontend | React 18 + TypeScript + Ant Design 5 |
| Build | Vite 5 + Cargo |

---

## License

[Apache License 2.0](LICENSE).
