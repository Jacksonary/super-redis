[English](README.md) | [简体中文](README.zh-CN.md)

# Super Redis Desktop

一款基于 [Tauri 2](https://v2.tauri.app/) + Rust + React 的跨平台 Redis 桌面客户端，功能参考 [AnotherRedisDesktopManager](https://gitee.com/qishibo/AnotherRedisDesktopManager)。开箱即用，无需部署。

**仓库**: [GitHub](https://github.com/Jacksonary/super-redis) | [Gitee](https://gitee.com/weiguoliu/super-redis)

## 功能

### 连接管理
- 多连接、彩色标签、分组、克隆、连接测试
- 单机 / Redis Cluster / Redis Sentinel 三种模式
- SSL/TLS（rediss）、ACL 用户名密码（Redis 6+）
- 只读模式

### Key 浏览
- 基于 SCAN 的分页浏览，绝不阻塞服务端（不使用 KEYS）
- 模式搜索（带历史）、批量删除 / 重命名 / 过期时间管理
- 单库 key 计数

### 值查看与编辑（逐类型）
- String（文本 / JSON 自动识别格式化）
- Hash（字段/值表格，新增、编辑、删除）
- List（分页、LPUSH/RPUSH、按值删除、按索引修改）
- Set（成员，添加/删除）
- ZSet / Stream / RedisJSON（第二阶段）

### 终端
- 命令控制台，支持历史与 pip 批量执行
- 发布 / 订阅消息

### 其它
- 浅色 / 暗色主题、界面缩放、简体中文 / 英文 i18n

## 下载

前往 [GitHub Releases](https://github.com/Jacksonary/super-redis/releases) 或 [Gitee Releases](https://gitee.com/weiguoliu/super-redis/releases) 下载安装包：

| 平台 | 格式 |
|---|---|
| Windows 64 位 | `.exe` (NSIS) / `.msi` |
| Linux | `.deb` / `.rpm` / `.AppImage` |
| macOS (Apple Silicon) | `.dmg` |

> macOS 版本未做签名/公证，若 Gatekeeper 提示"已损坏"，请移除隔离属性：
> ```bash
> xattr -cr "/Applications/Super Redis.app"
> ```

## 配置

连接配置保存在系统应用数据目录；密码仅存于系统钥匙串：

| 系统 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/super-redis/config.json` |
| Linux | `~/.config/super-redis/config.json` |
| Windows | `%APPDATA%\super-redis\config.json` |

## 从源码构建

```bash
# 前置：Rust、Node.js、Tauri 系统依赖
# Linux: sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev
# Tauri CLI：npm i（devDependencies 内含 @tauri-apps/cli）

git clone https://github.com/Jacksonary/super-redis.git
cd super-redis
npm install
npm run tauri dev
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 技术栈

| 分层 | 技术 |
|---|---|
| 框架 | Tauri 2 |
| 后端 | Rust + redis-rs（async，支持集群/哨兵/TLS） |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 构建 | Vite 5 + Cargo |

---

## License

[Apache License 2.0](LICENSE)。
