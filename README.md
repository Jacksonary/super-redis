[English](README.md) | [简体中文](README.zh-CN.md)

# Super Redis Desktop

A cross-platform Redis desktop client built with [Tauri 2](https://v2.tauri.app/) + Rust + React. Features reference [AnotherRedisDesktopManager](https://gitee.com/qishibo/AnotherRedisDesktopManager). Easy to use — just download and run.

**Repository**: [GitHub](https://github.com/Jacksonary/super-redis) | [Gitee](https://gitee.com/weiguoliu/super-redis)

## Screenshots

| Main Interface | New Connection |
|---|---|
| ![Main interface](docs/images/main.png) | ![New connection](docs/images/connection.png) |

| Hash Value | Monitor |
|---|---|
| ![Hash value](docs/images/hash.png) | ![Monitor](docs/images/monitor.png) |

## Features

### Connection Management
- Unlimited connections with color tags, groups (drag-and-drop), cloning, and one-click connection testing
- Live health indicator per connection (ok / error / disconnected)
- Standalone / Redis Cluster / Redis Sentinel modes
- SSL/TLS (rediss) with CA, client certificate (mTLS), SNI, and skip-verify
- ACL username/password (Redis 6+) and configurable timeout
- Read-only mode — write actions disabled throughout the UI, dangerous commands blocked in the console
- Database switcher with per-database key counts

### Key Browsing
- SCAN-based pagination that never blocks the server (no `KEYS`)
- Pattern search (`SCAN MATCH`)
- Flat list and tree view grouped by a configurable key separator, with collapsible folders
- Create keys (string / hash / list / set / zset) with optional TTL
- Rename, set TTL or persist, copy key name
- Batch delete by selection, or delete an entire folder by pattern
- `UNLINK` for non-blocking deletion of large values
- On-demand key metadata: type, TTL, memory usage, encoding

### Value Viewers
- **String** — inline editing, format conversion (text / JSON / hex / base64 / gzip / deflate / brotli / msgpack), automatic JSON pretty-printing, binary detection
- **Hash** — paged field/value table with add, edit, delete, field rename, and exact or fuzzy search
- **List** — paged view with LPUSH/RPUSH, edit by index, delete by value or index, and `LPOS` search
- **Set** — paged members with add, remove, rename, and membership or fuzzy search
- **ZSet** — paged members with add, score editing, remove, rename, and search
- **Stream** — entries, `XADD` / `XDEL`, consumer group creation, and `XINFO GROUPS`

### Monitor
- **Overview** — server, memory and stats cards, keyspace breakdown, and a searchable `INFO` view
- **Slow log** — `SLOWLOG GET` with severity coloring and reset
- **Memory analysis** — `MEMORY USAGE` sampling sorted by size, to surface large keys
- **Clients** — `CLIENT LIST` with self-highlighting and per-client kill
- **Command stats** — call counts, total time, per-call time and failure counts
- **Latency** — `LATENCY LATEST`

### Terminal
- Command console with quote-aware parsing and ↑/↓ history
- Blocking commands (SUBSCRIBE / MONITOR / BLPOP / XREAD…) are rejected with a clear message
- Dangerous-command detection, enforced when read-only mode is on

### Settings
- Light / dark theme
- Configurable key separator, SCAN batch size and operation interval
- Connection config import / export (JSON)
- Single-instance or multi-instance mode

### Application
- Built-in update check with in-app download and install
- Resizable sidebar and resizable table columns

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

## Buy Me a Beer

If you find this project helpful, feel free to buy the author a beer 🍺

<p align="center">
  <table align="center"><tr>
    <td align="center">
      <img src="docs/images/weixinpay.png" width="240" alt="WeChat Pay"><br>WeChat
    </td>
    <td width="60"></td>
    <td align="center">
      <img src="docs/images/alipay.png" width="240" alt="Alipay"><br>Alipay
    </td>
  </tr></table>
</p>
