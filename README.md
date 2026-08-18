# 风味设计工作台

辅助饮品风味研发的对话式工具,覆盖茶饮和酒精饮品。
一张卡片 = 一个方案 = 一场可中断可续接的对话。

按《风味设计工作台 · 完整规格 v2》实现。原型 `flavorworkbench.jsx` 只作交互参考,
代码全部重写 —— 尤其是原型里缺失的三块:**语音输入、团队共享、框架配置化**。

---

## 跑起来

需要 Node 20.6 以上。

```bash
npm install
npm run setup             # 交互式:问你要 API key,自动写好 .env
npm run dev               # 服务端 :8787 + 前端 :5173
```

打开 http://localhost:5173,用任意邮箱进入(开发级身份,见下)。

不想用 setup 也可以自己来 —— 下面两种都行:

```bash
cp .env.example .env      # 然后用编辑器填 ANTHROPIC_API_KEY
# 或者完全不建文件,启动时直接给:
ANTHROPIC_API_KEY=sk-ant-xxx npm run dev
```

优先级是「真实环境变量 > .env」,空字符串算没设。没有 key 时卡片照样能开、
参考库照样能记,只有 AI 推演接口返回 503。

生产构建:

```bash
npm run build && npm start   # 服务端同时托管前端静态文件
```

其他命令:`npm test`(逻辑测试)、`npm run typecheck`。

---

## 三块重做的部分

### 1. 框架配置化(§1 + §6.1)—— 架构级要求

规格里 §1 的全部内容是**知识**,不是**功能**。所以它不在代码里,而是一份可编辑的配置:

```
shared/framework/defaultFramework.ts   ← 种子数据,只在首次启动时写进存储
server/prompt.ts                       ← 从配置拼装系统提示,本身不含任何领域知识
```

代码里**没有**硬编码的 `6`,**没有** `"concept"` / `"structure"` 这类步骤字面量,
**没有**拼死在字符串里的系统提示。三类变更的成本:

| 变更 | 怎么做 | 代码改动 |
|---|---|---|
| 改定义、加规则 | 框架编辑界面改文本框 | 无 |
| 增删步骤 | 加/删一张步骤卡 | 无 —— 界面按数组长度渲染,AI 的输出 schema 按步骤 key 动态生成 |
| 改框架结构 | JSON 直编 | 少量 |

验证方式(已覆盖在 `npm test` 里):加一步「成本核算」保存 → 框架变 v2 → 新建卡片自动有 7 个槽,
脊柱、进度条、导出门槛、AI 的 `currentStep` 枚举全部跟着变。

**框架版本(§6.2):** 每次保存生成新版本号,卡片记录自己用的版本。
改了框架之后,旧卡片继续按它当初的版本推演(不会中途换规则),UI 上有提示;
被删掉的步骤,其结论仍然保留并标注「已从框架移除」,不静默丢用户的东西。

### 2. 语音输入(§6.3)—— 主要入口,不是附加功能

```
src/voice/types.ts          ← provider 接口
src/voice/webspeech.ts      ← 浏览器原生:实时逐字回显
src/voice/serverStt.ts      ← 录音 → 服务端转写:中文术语更准
src/voice/useVoiceInput.ts  ← 统一 hook
src/components/Composer.tsx ← 三个入口共用的复合输入框
```

- **两个 provider,可切换。** 浏览器原生零配置但支持面不齐;配了 `STT_BASE_URL`
  就多一个高精度选项(OpenAI 兼容的 `/audio/transcriptions`,Whisper 及多数国内厂商兼容层都可接)。
  没配就不显示这个选项,而不是给一个坏掉的按钮。
- **长句连续输入。** 浏览器会在静音几秒后自行结束识别;这里维护 `wantListening`,
  只要用户没按停止就自动重启,说一长段话中间可以喘气。
- **转写结果永远只进可编辑草稿,绝不自动发送。** 这是结构上保证的 —— hook 不持有正文,
  没有任何路径能让语音直接触发发送。识别错了就改,不用重说。
- **`inputMode` 全程记录**,消息、卡片起点、拆解感受栏都区分语音/打字来源。
- **文字是一等入口**:同一个框、同一个发送键、同样的 ⌘/Ctrl+Enter。办公室不方便说话时不打折。

三个入口都接上了:首页开卡 / 卡片内每一轮 / 拆解卡的「感受」栏。

### 3. 团队共享(§6.4)—— 数据结构现在就按多人设计

不是只留了字段,是整条链路都跑通了:

- **身份与归属**:`ownerId` / `workspaceId`,卡片三档可见性(私有 / 团队可见 / 团队可编辑)
- **参考库分层**:`scope` 为 personal 或 team;个人条目不进团队检索
- **溯源**:消息带 `authorId`,封步带 `confirmedBy`
- **多人接力同一张卡**:每次写入带 `rev`,过期写回 409 而不是静默覆盖;
  打开的卡片会轮询,别人改了自动同步(输入中/推演中不打断)
- **框架为团队级共享**,修改需要 admin/editor 权限
- **角色**:admin(改框架、加人)/ editor(开卡、写库、改框架)/ viewer(只读)

> ⚠️ **身份层是开发级的**:凭邮箱直接换 token,没有密码、没有邮件验证、没有 SSO。
> 它的作用是让权限模型和数据结构现在就跑起来。上线前必须替换成真实身份提供方 ——
> 只需要替换 `server/auth.ts`,下游拿到的都是 `AuthedRequest.auth`,与认证方式无关。

---

## 其余规格的落点

| 规格 | 实现位置 |
|---|---|
| §2 卡片数据结构 | `shared/types.ts` |
| §3 AI 行为规则 | 全部来自框架配置的 `behavior`,由 `server/prompt.ts` 拼装 |
| §3.7 结构化输出 | `server/ai.ts` —— 用 `output_config.format` + 动态 zod schema,不再手写 JSON 解析器 |
| §4 反向拆解 | `server/index.ts` 的 teardown 路由 + `src/components/TeardownCardView.tsx` |
| §4.2 双栏分开存 | `TeardownData.perception` / `.ingredients`,两栏独立字段,落差分析基于二者比对 |
| §4.4 confirmed / inferred | `ConfidenceTag` 组件,实线=确认、虚线=推测,归位项与「为什么好喝」各自独立标注 |
| §5.2 检索规则 | `server/retrieval.ts` —— 策略由配置的 `retrieval` 字段决定,不写死类型名 |
| §5.4 原料级索引 | `IngredientEntry`,设计与拆解都按原料析出条目 |
| §5.5 主动提示 | 每轮扫描原料名 → 注入历史用法 → `ingredientAlerts`,UI 上与正文区分显示 |
| §5.3 联网情报 | `web_search` 服务端工具,搜完沉淀进参考库而不是当场用掉 |
| §6.5 界面骨架 | 首页 / 设计卡 / 拆解卡三套布局,桌面侧栏 + 移动端顶部横条 |
| §6.6 自动保存 | 服务端防抖落盘 + 原子写 |

**回流是自动的:** 实践反馈里写了「机制」→ 自动成为失败记录(每轮必检);
评分 ≥4 且有配方 → 自动入好配方;拆解完成 → 拆解记录 + 按原料析出条目。

---

## 关于「AI 越用越准」

模型本身不会因为使用而改变。实际机制是:把参考库和过往卡片的确定结论,
在每次对话时检索并注入上下文。所以卡片和库条目从一开始就是结构化、可检索、可引用的数据,
不是一坨对话记录 —— 这是后期极难补救的部分,所以现在就做对。

---

## 架构

```
shared/          客户端与服务端共用的类型、框架种子数据、相关度算法
server/
  index.ts       路由
  store.ts       存储层(单文件 JSON + 原子写;换数据库只改这一个文件)
  prompt.ts      系统提示拼装 —— 零领域知识
  ai.ts          Anthropic 调用(结构化输出 + prompt caching)
  retrieval.ts   参考库检索策略
  auth.ts        身份层(待替换)
  stt.ts         语音转写转发
  env.ts         .env 加载(必须第一个被 import)
src/
  voice/         语音 provider 抽象
  components/    界面
```

**Prompt caching:** 系统提示拆成两块 —— 框架块(同版本内逐字节一致,打 `cache_control`)
和卡片状态块(每轮都变,放在缓存断点之后)。同一张卡多轮对话能持续命中缓存。

### 已知边界

- 存储是单文件 JSON,适合单机和小团队;并发写靠进程内串行 + `rev` 乐观锁。
  多实例部署需要先把 `server/store.ts` 换成真正的数据库。
- 协作同步是轮询(6–8 秒),不是实时推送。人数上来后建议换 SSE 或 WebSocket。
- 中文相关度是 2-gram 重合计数(规格建议的基线)。要提升召回可换成 embedding,
  只需替换 `shared/relevance.ts` 的 `relScore`。
