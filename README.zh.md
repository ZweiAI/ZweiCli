# Zwei CLI

<p align="right"><a href="./README.md">English</a> | <b>简体中文</b></p>

> **实验性项目**。双 agent 编码工具。**PhD 写代码,Supervisor 做验证。**
>
> 重新思考编码 agent 的组织方式:两个隔离的头脑、一份代码、单向流动的记忆。
>
> Fork 自 [opencode](https://github.com/sst/opencode)。
>
> _"Zwei" — 德语的 "2"。_

---

## 为什么

大多数编码 agent 把所有事塞进一个上下文:读代码、写代码、跑测试、打分、重试。任务一长,注意力被稀释,测试输出淹没意图,agent 最后只能自己给自己的作业打分。

Zwei 借鉴了学术界的套路:**PhD 写论文,Supervisor 打分。** 两个会话物理隔离,各有各的 skill 集合,信息只在边界上单向流动。写代码的那边永远看不到打分者的推理过程 —— 所以它没法针对验证器去优化。

## 核心理念

- **双重注意力** —— 两个会话物理隔离。PhD 只写代码,Supervisor 只做审查,两边的注意力不互相抢占。
- **独立 skill** —— 两个角色各自加载自己的 skill 集合,默认不共享。PhD 不会被审查工具分心,Supervisor 也不会伸手去改代码。
- **非对称记忆** —— PhD 永远看不到 Supervisor 的推理过程,只能拿到结构化判决;Supervisor 能看到 PhD 的代码和测试输出。记忆是单向流动的,这是设计。
- **写测分离** —— PhD 没有 `bash`、不能读测试文件。自我验证在物理上就不可能,写代码者的上下文里也不会混入工具调用轨迹、测试输出、文件 dump —— 没有上下文污染。

合起来的效果:写代码者没法通过揣摩 Supervisor 的措辞去 Goodhart 验证器,两边的上下文也不会被对方的产物污染。

## 安装

### 从源码装

```bash
git clone https://github.com/ZweiAI/ZweiCli
cd ZweiCli
bun install
bun run --cwd packages/zwei dev --help
```

### 从 npm 装(待发布)

```bash
npm install -g zweicli
zwei --help
```

dual 循环之外的所有内容(鉴权、模型、provider、会话、web UI 等)仍沿用上游 opencode 的约定。参见 [opencode.ai](https://opencode.ai)。

## 状态

Pre-1.0,实验性。架构和术语都可能继续调整。欢迎提 issue 和 PR —— 特别欢迎反馈"这个工作负载上 dual 赢了/输了 single"的实际观察。

## License

MIT。详见 [LICENSE](./LICENSE) —— 保留了上游 opencode 的版权声明,并在其下追加了 ZweiAI 的版权行。
