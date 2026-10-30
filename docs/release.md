# 发布

版本号以 `apps/desktop/package.json` 为准。发布前在 [`CHANGELOG.zh-CN.md`](../CHANGELOG.zh-CN.md) 和 [`CHANGELOG.md`](../CHANGELOG.md) 中添加同版本、同日期、条目一一对应的章节，然后手动运行 GitHub Actions 的 `release` workflow。预检会拒绝已被使用的版本。

CI 只在手动运行 `release` workflow 时构建并发布 macOS（Apple Silicon / Intel）DMG 与 Windows x64 安装包。

Release 正文先中文后英文；应用内更新提示按界面语言显示其中一种。可选的 Cloudflare R2 `latest` 镜像在 [`.pine/release.json`](../.pine/release.json) 中配置，自动更新检查和安装包下载走该域名。所需的 Secrets 与缓存规则见 [`.github/workflows/release.yml`](../.github/workflows/release.yml)。
