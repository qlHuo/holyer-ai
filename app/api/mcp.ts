import request from './request'
import type {
  CreateMcpServerInput,
  McpProbeInput,
  McpRefreshResult,
  McpServerSummary,
  PatchMcpServerInput,
  ProbeResult,
  UpdateMcpServerInput
} from '~~/shared/types/mcp'

export default {
  /**
   * @Description 获取 MCP Server 列表 GET /api/mcp/servers
   * @returns {Promise<McpServerSummary[]>}
  */
  getServers() {
    return request<McpServerSummary[]>(`/api/mcp/servers`)
  },

  /**
   * @Description 新建 MCP Server POST /api/mcp/servers
   * @param {CreateMcpServerInput} data
   * @returns {Promise<McpServerSummary>}
  */
  createServer(data: CreateMcpServerInput) {
    return request<McpServerSummary>(`/api/mcp/servers`, {
      method: 'POST',
      body: data
    })
  },

  /**
   * @Description 全量修改 MCP Server PUT /api/mcp/servers/:id
   * @param {string} id
   * @param {UpdateMcpServerInput} data
   * @returns {Promise<McpServerSummary>}
  */
  updateServer(id: string, data: UpdateMcpServerInput) {
    return request<McpServerSummary>(`/api/mcp/servers/${id}`, {
      method: 'PUT',
      body: data
    })
  },

  /**
   * @Description 局部修改（启停 / 工具开关）PATCH /api/mcp/servers/:id
   * @param {string} id
   * @param {PatchMcpServerInput} data
   * @returns {Promise<McpServerSummary>}
  */
  patchServer(id: string, data: PatchMcpServerInput) {
    return request<McpServerSummary>(`/api/mcp/servers/${id}`, {
      method: 'PATCH',
      body: data
    })
  },

  /**
   * @Description 删除 MCP Server DELETE /api/mcp/servers/:id
   * @param {string} id
   * @returns {Promise<boolean>}
  */
  deleteServer(id: string) {
    return request<boolean>(`/api/mcp/servers/${id}`, {
      method: 'DELETE'
    })
  },

  /**
   * @Description 测试连通性（不落库）POST /api/mcp/servers/probe
   * @param {McpProbeInput} data
   * @returns {Promise<ProbeResult>}
  */
  probe(data: McpProbeInput) {
    return request<ProbeResult>(`/api/mcp/servers/probe`, {
      method: 'POST',
      body: data
    })
  },

  /**
   * @Description 刷新工具快照 POST /api/mcp/servers/:id/refresh
   * @param {string} id
   * @returns {Promise<McpRefreshResult>}
  */
  refresh(id: string) {
    return request<McpRefreshResult>(`/api/mcp/servers/${id}/refresh`, {
      method: 'POST'
    })
  }
}
