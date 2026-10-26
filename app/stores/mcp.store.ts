/**
 * MCP Server store — 管理页的列表与操作
 *
 * 探测（probe）不落库、不改列表，由表单弹窗直接拿返回值展示。
 */
import { ref } from 'vue'
import type {
  CreateMcpServerInput,
  McpProbeInput,
  McpRefreshResult,
  McpServerSummary,
  PatchMcpServerInput,
  ProbeResult,
  UpdateMcpServerInput
} from '~~/shared/types/mcp'
import McpApi from '~/api/mcp'

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<Array<McpServerSummary>>([])
  const loading = ref(false)
  const loadError = ref<string | null>(null)

  /** 获取 Server 列表（防重入 + 三态） */
  async function getServers() {
    if (loading.value) return
    loading.value = true
    loadError.value = null
    try {
      servers.value = await McpApi.getServers()
    } catch (error: any) {
      loadError.value = error?.message || '加载 MCP Server 失败'
    } finally {
      loading.value = false
    }
  }

  async function createServer(data: CreateMcpServerInput) {
    const detail = await McpApi.createServer(data)
    servers.value.push(detail)
    return detail
  }

  async function updateServer(id: string, data: UpdateMcpServerInput) {
    const detail = await McpApi.updateServer(id, data)
    replace(detail)
    return detail
  }

  async function patchServer(id: string, data: PatchMcpServerInput) {
    const detail = await McpApi.patchServer(id, data)
    replace(detail)
    return detail
  }

  async function removeServer(id: string) {
    const deleted = await McpApi.deleteServer(id)
    if (deleted) {
      servers.value = servers.value.filter(item => item.id !== id)
    }
  }

  async function refreshServer(id: string): Promise<McpRefreshResult> {
    const result = await McpApi.refresh(id)
    replace(result.server)
    return result
  }

  function probe(data: McpProbeInput): Promise<ProbeResult> {
    return McpApi.probe(data)
  }

  function replace(detail: McpServerSummary) {
    servers.value = servers.value.map(item => item.id === detail.id ? detail : item)
  }

  return {
    servers,
    loading,
    loadError,
    getServers,
    createServer,
    updateServer,
    patchServer,
    removeServer,
    refreshServer,
    probe
  }
})
