# DSH ALK Pet

独立的 DeepSeek Harness 桌面端宠物插件。macOS 与 Windows 使用跨应用置顶的原生悬浮窗；原生窗口不可用时，角色显示在 DSH 页面右下角。宠物根据会话事件切换待机、思考、工作、等待、完成、错误状态，并显示当前待办或工具动作。

角色素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，使用参考仓库 `dsh-dafeiyu` 导出的六组动作帧。动画按约 12 帧/秒播放；完成和错误动作播放一遍后继续循环待机动作。素材按 MIT 许可分发，许可文本见 [assets/LICENSE.txt](assets/LICENSE.txt)。这不是 DeepSeek 官方插件。

## 预览

![多任务与状态圆点](docs/screenshots/multi-task.png)

![任务超过 12 个时自动换行](docs/screenshots/multi-row.png)

## 安装

在 DeepSeek Harness 桌面端的插件页面选择“添加插件”，输入此目录的绝对路径，安装并启用。开发时也可以在退出桌面端后，使用桌面端自带的 `dsh` 命令安装：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-alk-pet
```

插件同时兼容 WebUI 的客户端插槽；桌面端与 WebUI 需在各自的 profile 安装。克隆或下载后可按本地路径安装；发布到 npm 后也可直接用包名安装：

```sh
dsh plugin --profile web add dsh-alk-pet
```

## 设置

`cordis.patch.yml` 提供以下默认配置，修改后需重启 Host 并刷新客户端：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关闭后不启动原生窗口，Web 端也不渲染角色 |
| `size` | `120` | 角色显示尺寸，Host 与客户端统一夹在 72–200 之间 |
| `reducedMotion` | `false` | 只显示第 1 帧，适合晕动症或省电 |
| `showBubble` | `true` | 是否显示标题/动作气泡（任务切换圆点不受影响） |

原生宠物可拖动。macOS 位置保存在 `UserDefaults`，Windows 保存在 `%LOCALAPPDATA%\\dsh-alk-pet\\window.json`；网页回退版本的位置保存在当前客户端的 localStorage，窗口缩放后会自动夹回屏幕内。

待机时不显示气泡。工作状态下，气泡在角色头顶，使用紧凑的深色圆角样式：第一行对应 DSH 侧边栏的用户会话标题，即使当前动作来自子 Agent，也不会显示子会话标题。第二行显示当前待办、步骤或工具动作；工具动作会带上正在处理的命令、文件或查询等关键参数（例如“正在运行命令 · npm test”）。两行均只展示一行文字，过长时以省略号截断，气泡高度不会随内容增长。

任务完成后，气泡会保留到你在 DSH 中打开对应会话并查看结果；如果该会话已打开，点击内容区域或重新切回 DSH 后隐藏。宠物动画会持续播放。

同时运行多个顶层会话时，气泡上方会出现任务切换圆点：每个任务是 20px 的纯圆形，没有背景框，直接悬浮在气泡上方；选中项用白色描边标出。运行中是青绿色圆点里一个白色小方块，等待确认是琥珀色问号，成功是绿色勾，失败是玫瑰红叉，待机是灰色圆环。圆点每行最多 12 个，超过自动换行。鼠标移入某个圆点会立即切换到该任务（不再响应点击切换）；鼠标停留在圆点区域时轮播暂停，移开约 2 秒恢复轮播（客户端异常断开时悬停会在 5 分钟后自动失效）。多任务时，轮播中的气泡宽度取所有任务内容中最大的那个，切换任务时宽度保持不变，仍受 300px 上限约束；鼠标移入某个圆点后轮播暂停，气泡宽度改为只按当前悬停的任务计算，移开圆点恢复按所有任务取最大。完成或失败任务会保留，直到你查看对应会话的结果后才移除；被用户中止的轮次不会留下脱机圆点。子 Agent 的活动会归到其所属的顶层会话，不额外生成任务项。

## 安全与兼容性

所有本地 HTTP 接口（`/plugins/dsh-alk-pet/*`）只校验 TCP 对端是否为回环地址（`127.0.0.1` / `::1`），因此只适合本机直连的 WebUI；不要把 WebUI 暴露到不受信任的网络，也不要把它当作登录鉴权使用。Windows 原生窗口使用分层窗口逐像素透明（不再使用颜色键控），并启用每显示器 DPI 感知；取决于系统策略，PowerShell 脚本可能被限制执行，此时会自动回退到网页内角色。随包 macOS Helper 目前为 Apple Silicon 版本；Intel Mac 可用本机工具链重新构建。原生窗口异常退出时会自动重启两次，仍失败则回退到网页内角色。

## 开发

```sh
npm test                 # 状态机、任务板、运行时、HTTP 接口、客户端布局与素材测试
npm run build:assets     # 重新归一化动画背景 alpha 并生成 assets/animations/manifest.json
npm run check:assets     # 校验素材与 manifest 是否最新（CI 用）
npm run build:native     # macOS：从 native/macos/Pet.swift 重新构建随包 Helper
```

帧数、帧间隔和素材版本统一记录在 `assets/animations/manifest.json`，Host 启动时读取并通过 SSE/原生消息下发，作为唯一权威来源；各端只保留与旧版本一致的缺省回退常量，仅在消息缺少 `clips` 时使用。素材帧的背景 alpha 必须完全为 0（`build:assets` 会把 alpha < 8 的像素清零），否则 Windows 分层窗口会出现底噪。

macOS Helper 的预览模式：设置 `DSH_ALK_PET_SNAPSHOT=/tmp/pet.png` 后启动 Helper，应用首条消息后会把整个悬浮层渲染成 PNG 再退出，便于检查视觉。Host 侧使用 Cordis 的 `apply(ctx, config)` 与 `session/event`；窗口内回退版本通过本机 SSE 与 `shell.overlay` 插槽工作。

当前 CommandLineTools 若出现 “this SDK is not supported by the compiler” 的工具链/SDK 版本错配，`build:native` 会先用本机编译器版本修补一份临时 SDK 再构建，无需手动改系统文件。

## 许可

代码以 MIT 许可发布，见 [LICENSE](LICENSE)。角色动画素材来自 PC2005-cloud/dsh-pet，按 MIT 分发，原始版权声明见 [assets/LICENSE.txt](assets/LICENSE.txt)。本项目与 DeepSeek 官方无关。
