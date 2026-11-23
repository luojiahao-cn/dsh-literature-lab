# DSH Literature PDF Bridge

1. 打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择本目录。
2. 在扩展选项里确认「自动处理出版社文章页」、下载子目录（默认 `论文`）、bridge 端口（默认 `27888`）。
3. 填 **bridge token**：插件 `state/config.json` 的 `bridge.token`（32 位）。插件 bridge 现在必须校验 `x-dsh-token`，token 为空或填错会 401。
4. 默认不自动下载。打开 IEEE/ASME/Wiley/Elsevier/Springer 文章页后，点扩展图标，才抓取当前页 PDF，下载到 `~/Downloads/论文/`，并写同名 `.json`。
5. 扩展带 `x-dsh-token` POST 到 `127.0.0.1:27888/import`，插件导入；插件仍监听该目录作为兜底。

> token 变更后要重启 DSH（bridge server 启动时读取），再更新扩展选项。
