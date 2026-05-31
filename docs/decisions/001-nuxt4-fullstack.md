# ADR-001: Nuxt 4 全栈方案

> 日期：2026-05-31 · 状态：✅ 已采纳

---

## 背景

项目需要一个前后端统一的技术栈来构建 AI 对话平台。核心需求：SSE 流式传输、多 LLM Provider 调用、Agent 工具循环、未来扩展到 Skills/MCP/RAG。

## 决策

**选择 Nuxt 4 作为唯一全栈技术栈**，不引入独立的 NestJS 或 Python 后端。

## 对比

| 维度 | Nuxt 4 全栈 | NestJS 纯后端 | Python (FastAPI) |
|------|-------------|--------------|------------------|
| 前后端统一 | ✅ 单一语言/项目 | ❌ 需另建前端 | ❌ 需另建前端 |
| AI 生态深度 | ⚠️ LangChain.js 可用 | ⚠️ 同 TypeScript | ✅ LangChain/LlamaIndex |
| 本地模型推理 | ❌ 不支持 | ❌ 不支持 | ✅ PyTorch/TensorFlow |
| 部署多样性 | ✅ 20+ 平台一键适配 | 需手动配置 | 手动配置 |

## 关键理由

1. **本项目 AI 调用均为外部 API**（OpenAI / Anthropic / DeepSeek），不涉及本地模型推理或 LangChain 复杂编排
2. **Nitro 服务端能力足够**：SSE 原生支持、文件系统路由、中间件体系
3. **单一语言/项目降低复杂度**：个人开发场景，维护两套代码成本过高
4. **Cloudflare Pages 部署**：Nuxt 4 的 `cloudflare-pages` preset 一键适配

## 代价

- LangChain.js 生态比 Python 弱，但不影响本项目（不使用 LangChain）
- 无法本地推理模型，但本项目本来就只调外部 API

## 替代方案（已否决）

- **NestJS**：功能完备但需要另建前端，个人维护成本高
- **Python FastAPI**：AI 生态最强，但前后端分离 + 部署复杂度增加
