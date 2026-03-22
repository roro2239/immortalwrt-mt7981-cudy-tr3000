# UFI-TOOLS LuCI 封装设计

## 目标

在 ImmortalWrt 后台新增一个独立顶级菜单 `UFI-TOOLS`，将现有 `http://192.168.0.1:2333/` 封装进 LuCI 后台内使用，同时满足下面 3 个约束：

1. 不修改 `UFI-TOOLS` 原项目。
2. 完整保留其原始后台能力，包括它自己的插件注入、自定义头部、上传资源、原厂 `goform` 反向代理链路。
3. 外层交互风格跟随当前 OpenWrt / LuCI，菜单位置插入“服务”和 `iStore` 之间。

## 调研结论

### 1. `UFI-TOOLS` 不是单纯静态站点

`UFI-TOOLS` 由 Android 侧服务 `WebService` 启动 Ktor 服务，固定监听 `2333` 端口。

关键点：

1. `app/src/main/java/com/minikano/f50_sms/WebService.kt`
   - 固定启动 `KanoWebServer(applicationContext, 2333, currentIp)`。
2. `app/src/main/java/com/minikano/f50_sms/modules/mainModule.kt`
   - 路由同时挂载静态资源、认证、主题、插件、反向代理、设备信息、ADB、短信、测速等模块。
3. `app/src/main/java/com/minikano/f50_sms/modules/reverseProxyModule.kt`
   - `"/api/goform/{...}"` 反向代理到原厂后台。
4. `app/src/main/java/com/minikano/f50_sms/modules/staticFileModule.kt`
   - 根路径直接按资产目录返回 `index.html`、JS、CSS、图片等静态资源。

结论：
LuCI 侧如果重写页面，只能拿到“像它”的界面，拿不到它现有完整行为链路。

### 2. 它自己的插件能力依赖原页面原样运行

`UFI-TOOLS` 前端会从后端读取自定义头部文本，再把里面的 `style/link/meta/script` 注入页面。

关键点：

1. `app/src/main/java/com/minikano/f50_sms/modules/plugins/pluginsModule.kt`
   - 提供 `/api/get_custom_head`、`/api/set_custom_head`、`/api/plugins_store`。
2. `app/frontEnd/public/script/main.js`
   - 启动时调用 `getCustomHead()`，把返回内容直接注入 `document.head`。
   - 插件管理 UI 本质上也是围绕这段注入内容在工作。

结论：
只要不是原页面原样运行，这部分插件 UI 与扩展脚本就不可能完整继承。

### 3. 最稳妥路线不是“重写”，而是“LuCI 外壳 + 原后台承载”

满足“零改原项目 + 完整复刻 + 保留插件扩展”的可行路线只有两类：

1. `iframe` 承载原始页面。
2. LuCI 侧完整反向代理整站，再在 LuCI 页面承载代理结果。

对比：

1. `iframe`
   - 优点：实现最小，最符合“原样复刻”，对 `UFI-TOOLS` 零侵入。
   - 优点：它自己的插件、自定义头部、上传资源、鉴权逻辑都继续按原逻辑运行。
   - 风险：跨域 `iframe` 高度无法自动适配，只能做全屏固定高度容器。
2. LuCI 侧整站反向代理
   - 优点：理论上可做成同源。
   - 缺点：实现复杂度明显更高，需要覆盖静态资源、Cookie、Header、上传、缓存、错误处理。
   - 缺点：后续 `UFI-TOOLS` 升级后，兼容性维护成本高。

推荐结论：
首版应采用 `iframe` 方案。它是唯一同时满足“零改原项目、完整保留原能力、维护成本可控”的方案。

## 推荐实施方案

### 当前推荐方向

当前更推荐“单个 LuCI 插件”而不是“双插件”。

原因只有一句话：
如果首要目标是“把现有后台完整装进 OpenWrt 后台里可直接操作”，单插件最简单，风险最小，维护成本最低。

适用前提：

1. 接受首版以原页承载为主。
2. 接受 OpenWrt 风格主要体现在菜单、标题、工具栏和外层容器。
3. 接受后续若要做 LuCI 原生页，再作为第二阶段追加，而不是首版就双线并行。

## 已实施

当前仓库已按“单个 LuCI 插件”路线完成首版落地：

1. 新增包：`package/luci-app-ufi-tools`
2. 已提供：
   - 顶级菜单 `UFI-TOOLS`
   - 默认地址配置 `http://192.168.0.1:2333/`
   - LuCI 外层工具栏：`加载地址 / 刷新内嵌页 / 新窗口打开`
   - 原版后台内嵌承载页
   - `UCI` 配置与 `ACL`
3. 已接入构建链路：
   - `config/256m.config`
   - `diy-part1.sh`

当前实现边界不变：

1. 首版不重绘 `UFI-TOOLS` 内部页面。
2. 首版不实现 LuCI 原生功能页。
3. 首版目标是“完整承载原后台 + 在 OpenWrt 后台提供统一入口”。

### 菜单结构

新增一个 LuCI 独立顶级菜单：

1. 顶级节点：`UFI-TOOLS`
2. 菜单位置：介于“服务”和 `iStore` 之间
3. 实现方式：新建 `luci-app-ufi-tools`

说明：

1. `iStore` 当前顶级入口是 `admin/store`，顺序值 `31`。
2. 因此 `UFI-TOOLS` 应做成新的顶级入口，顺序值应小于 `31` 且大于“服务”。
3. 不建议挂到 `admin/services/ufi-tools`，否则不会出现在你要求的顶级菜单位置。

### 页面结构

LuCI 页面只负责外层壳，不重写 `UFI-TOOLS` 内容。

建议页面由两部分组成：

1. 顶部轻量工具栏
   - 后端地址显示
   - 刷新按钮
   - 新窗口打开按钮
   - 连通性状态提示
2. 主体内容区
   - 一个全宽高 `iframe`
   - 默认加载 `http://192.168.0.1:2333/`

这样用户感知是：

1. 仍然在 LuCI 后台里。
2. 左侧/顶部菜单仍然是 OpenWrt 风格。
3. 内容区完整显示原始 `UFI-TOOLS` 后台。

### 配置策略

LuCI 侧单独增加一个最小配置：

1. `uci` 配置名：`ufi-tools`
2. 默认地址：`http://192.168.0.1:2333/`
3. 可在 LuCI 页面中修改保存

这样可以兼容：

1. 用户改了 UFI 设备地址
2. 用户不使用默认 `192.168.0.1`
3. 后续有局域网多设备场景

### 风格策略

“跟随当前 OpenWrt 风格”的边界应定义为：

1. 菜单、标题、工具栏、按钮、空状态、错误提示使用当前 LuCI 风格。
2. `iframe` 内部保持 `UFI-TOOLS` 原始样式，不做重绘。

原因：

1. 这才符合“完全复刻它的后台”。
2. 也符合“不要改它项目”的硬约束。

如果强行把 `iframe` 内部做 LuCI 主题化，就已经等于改造 `UFI-TOOLS` 前端，不再是封装。

## 计划中的包结构

首版实现预计只需要新增一个独立包目录：

1. `package/luci-app-ufi-tools/Makefile`
2. `package/luci-app-ufi-tools/htdocs/luci-static/resources/view/ufi-tools/overview.js`
3. `package/luci-app-ufi-tools/root/usr/share/luci/menu.d/luci-app-ufi-tools.json`
4. `package/luci-app-ufi-tools/root/usr/share/rpcd/acl.d/luci-app-ufi-tools.json`
5. `package/luci-app-ufi-tools/root/etc/config/ufi-tools`

说明：

1. `overview.js` 负责 LuCI 外壳页面与 `iframe`。
2. `ACL` 只开放读取/保存本插件自身配置所需权限。
3. 不引入 `uhttpd` 反向代理，不改现有系统服务。

## 已知风险

1. 如果目标 `UFI-TOOLS` 服务不可达，页面只能显示连接失败提示。
2. 若未来 `UFI-TOOLS` 主动加入 `X-Frame-Options` 或 CSP `frame-ancestors` 限制，`iframe` 方案会失效。
3. 由于跨域限制，LuCI 外层不能精确读取 `iframe` 内部高度与状态，只能做固定高度全屏容器。
4. `UFI-TOOLS` 内部若触发 `window.location.href` 跳转，行为仍发生在 `iframe` 内部；这通常可接受，但需要首版手工验证。

## 不建议的方案

1. 不建议重写一个“仿 UFI-TOOLS” 页面。
   - 原因：无法保留其插件注入与完整数据链路。
2. 不建议首版就做 LuCI 侧整站反向代理。
   - 原因：复杂度高，维护成本高，不符合 KISS。
3. 不建议改 `UFI-TOOLS` 源码去适配 LuCI。
   - 原因：与当前硬约束冲突。

## 双插件方案

你提到的“双插件”可以做，但要先把目标定义清楚。

这里的“双插件”指：

1. 在 `UFI-TOOLS` 侧写一个插件。
2. 在 OpenWrt / LuCI 侧再写一个插件。

### 这条路线什么时候成立

这条路线成立的前提不是“完整复刻原后台”，而是：

1. 允许我们只覆盖一部分功能。
2. 允许 `LuCI` 页面成为新的主界面。
3. 允许 `UFI-TOOLS` 侧插件只负责提供数据、能力桥接或一个专用嵌入页面。

如果目标还是“未来它新增什么插件 UI，这边自动同步出来”，那双插件也做不到。

### 推荐的双插件职责拆分

推荐拆成下面两层：

1. `UFI-TOOLS` 插件
   - 负责暴露一个稳定、面向外部的轻量接口层。
   - 负责把原本散落在原页面里的调用整理成更适合外部消费的 API。
   - 可选提供一个“嵌入专用页”或“聚合状态页”。
2. `LuCI` 插件
   - 负责 OpenWrt 风格菜单、表单、状态页、按钮交互。
   - 负责把 `UFI-TOOLS` 插件输出的接口映射成 LuCI 原生组件。
   - 负责地址配置、连通性检测、错误提示、权限提示。

### 最合理的双插件实现方式

我建议不是让 `UFI-TOOLS` 插件去“画完整 UI”，而是只做下面 3 类事：

1. 数据聚合
   - 例如把状态页所需字段聚成一个接口，减少 LuCI 端自己拼接几十个请求。
2. 能力桥接
   - 例如把登录、短信、AT、锁频、ADB、插件列表等能力整理成稳定接口。
3. 嵌入辅助
   - 例如提供一个更适合被 `iframe` 或外部容器承载的专用页面。

这样 OpenWrt 侧插件就能画出真正原生的 LuCI 页面。

### 双插件方案的优点

1. LuCI 页面可以真正跟随 OpenWrt 风格。
2. 可以只重做高频功能，避免一开始就重写全部后台。
3. `UFI-TOOLS` 主项目可以保持不改，只新增插件包。
4. 后续可以按模块逐步迁移，而不是一次性推倒重来。

### 双插件方案的硬伤

1. 它不是“完全复刻原后台”。
2. 原后台已有插件注入出来的 UI，不会自动变成 LuCI 组件。
3. 后续新增的 `UFI-TOOLS` 第三方插件，如果没有同步适配 LuCI，这边看不到原生 UI。
4. 维护成本会变成两套：
   - `UFI-TOOLS` 插件接口
   - `LuCI` 插件界面

### 工程上最实际的落地方式

如果走双插件，我建议采用“混合双插件”而不是“全量双插件重写”：

1. 第一层：先保留原页嵌入入口
   - 用于兜底所有完整能力和未来第三方插件 UI。
2. 第二层：逐步补 LuCI 原生页
   - 先做状态总览
   - 再做短信
   - 再做 AT / ADB / 锁频等高频页面
3. 第三层：`UFI-TOOLS` 插件只负责给这些 LuCI 页面提供稳定接口

这样结果会是：

1. 想要完整功能，进“原版界面”。
2. 想要日常高频操作，进“LuCI 原生页”。

### 对你的需求的判断

如果你现在最看重的是：

1. 看起来像 OpenWrt 原生页面
2. 但又不想丢掉原后台和未来插件

那最合适的不是“二选一”，而是：

1. 一个 `LuCI` 插件
   - 顶级菜单 `UFI-TOOLS`
   - 里面既有“总览/常用功能”原生页
   - 也有“原版后台”入口
2. 一个 `UFI-TOOLS` 插件
   - 只做聚合 API / 嵌入辅助 / 稳定桥接

这才是双插件方案里最稳的做法。

## 待确认项

需要你确认的不是技术可行性，而是产品取舍：

1. 是否接受首版采用 `iframe` 封装，而不是 LuCI 重写页面。
2. 是否接受 `UFI-TOOLS` 作为独立顶级菜单，而不是“服务”下面的子菜单。
3. 是否接受默认地址做成可配置项，默认值为 `http://192.168.0.1:2333/`。
4. 若改走双插件方案，是否接受“LuCI 原生页 + 原版后台入口并存”，而不是一次性全量重写。

以上 4 项确认后，再进入实现阶段。
