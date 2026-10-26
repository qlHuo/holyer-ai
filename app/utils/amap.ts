/**
 * 高德 MCP 工具元数据与 schema 结果解析（纯函数，便于单独测试）
 *
 * 官方 `maps_schema_*` 工具返回的是「唤端 URI」而不是地图图片/组件：
 * - maps_schema_personal_map → 行程地图打开链接
 * - maps_schema_navi         → 导航唤端 URI
 * - maps_schema_take_taxi    → 打车唤端 URI
 *
 * 这里同时维护工具卡片标题与唤端按钮文案的唯一来源，避免两处各写一套后漂移。
 */

export interface AmapToolMeta {
  /** 工具名后缀（真实工具名带 Server slug 前缀，如 gaode__） */
  suffix: string
  /** 工具卡片标题 */
  label: string
  icon: string
  /** 仅 schema 工具有：唤端按钮文案 */
  actionLabel?: string
}

/** 高德 15 个工具的展示元数据；顺序不影响匹配（按后缀） */
export const AMAP_TOOL_META: AmapToolMeta[] = [
  { suffix: 'maps_direction_driving', label: '驾车路线', icon: 'i-lucide-car' },
  { suffix: 'maps_direction_walking', label: '步行路线', icon: 'i-lucide-footprints' },
  { suffix: 'maps_direction_bicycling', label: '骑行路线', icon: 'i-lucide-bike' },
  { suffix: 'maps_direction_transit_integrated', label: '公交路线', icon: 'i-lucide-bus' },
  { suffix: 'maps_distance', label: '距离测量', icon: 'i-lucide-ruler' },
  { suffix: 'maps_geo', label: '地址转坐标', icon: 'i-lucide-map-pin' },
  { suffix: 'maps_regeocode', label: '坐标转地址', icon: 'i-lucide-map-pin' },
  { suffix: 'maps_ip_location', label: 'IP 定位', icon: 'i-lucide-locate-fixed' },
  { suffix: 'maps_text_search', label: '地点搜索', icon: 'i-lucide-search' },
  { suffix: 'maps_around_search', label: '周边搜索', icon: 'i-lucide-radar' },
  { suffix: 'maps_search_detail', label: '地点详情', icon: 'i-lucide-info' },
  { suffix: 'maps_weather', label: '天气查询', icon: 'i-lucide-cloud-sun' },
  {
    suffix: 'maps_schema_personal_map',
    label: '行程地图',
    icon: 'i-lucide-map',
    actionLabel: '在地图中打开行程'
  },
  {
    suffix: 'maps_schema_navi',
    label: '高德导航',
    icon: 'i-lucide-navigation',
    actionLabel: '唤起高德导航'
  },
  {
    suffix: 'maps_schema_take_taxi',
    label: '高德打车',
    icon: 'i-lucide-car-taxi-front',
    actionLabel: '在高德中打车'
  }
]

/**
 * 优先匹配高德域名；其次 App scheme；最后才在短结果里兜底任意 http。
 *
 * 终止符包含中文标点与 CJK 汉字：模型常写「点击https://...打开」这种无空格拼接，
 * 不把汉字当终止符会把「打开」吞进 URL。
 */
const AMAP_URL_RE = /https?:\/\/(?:[\w-]+\.)*(?:amap\.com|autonavi\.com)[^\s"'<>()[\]{}，。；;、（）【】《》一-鿿]*/i
const HTTP_URL_RE = /https?:\/\/[^\s"'<>()[\]{}，。；;、（）【】《》一-鿿]+/i
const APP_URI_RE = /(?:amapuri|androidamap|iosamap):\/\/[^\s"'<>()[\]{}，。；;、（）【】《》一-鿿]+/i

export interface AmapActionMeta {
  label: string
  icon: string
}

export interface AmapAction extends AmapActionMeta {
  url: string
  /** http(s) 才新窗口打开；App scheme 交给系统处理 */
  external: boolean
}

/** 工具卡片标题/图标；非高德工具返回 null */
export function amapToolMeta(toolName: string): AmapToolMeta | null {
  return AMAP_TOOL_META.find(item => toolName.endsWith(item.suffix)) ?? null
}

/** schema 唤端按钮文案；普通工具或没有 actionLabel 时返回 null */
export function amapActionMeta(toolName: string): AmapActionMeta | null {
  const meta = amapToolMeta(toolName)
  if (!meta?.actionLabel) return null
  return { label: meta.actionLabel, icon: meta.icon }
}

/**
 * 从工具结果里提取链接。
 *
 * 兼容：纯 URI、JSON（`{"url":"..."}`）、转义斜杠（`https:\/\/`）、`&amp;`。
 * 防误判：高德域名与 App scheme 无条件接受；任意 http 只在结果很短
 * （几乎就是一个链接）时兜底，避免把错误文案里的文档链接当成地图链接。
 */
export function extractAmapLink(result: string | undefined): string | null {
  if (!result) return null

  const text = result.replace(/\\\//g, '/').replace(/&amp;/g, '&')
  const matched = text.match(AMAP_URL_RE) ?? text.match(APP_URI_RE)
  const fallback = text.trim().length <= 200 ? text.match(HTTP_URL_RE) : null
  const url = (matched ?? fallback)?.[0]
  if (!url) return null

  return url.replace(/[),.;]+$/, '')
}

/**
 * 工具调用 → 按钮数据。
 *
 * 只对 `done` 状态生效：running 时结果还没回来，error 时结果通常是错误文案。
 */
export function resolveAmapAction(
  toolName: string,
  status: 'running' | 'done' | 'error',
  result?: string
): AmapAction | null {
  if (status !== 'done') return null

  const meta = amapActionMeta(toolName)
  if (!meta) return null

  const url = extractAmapLink(result)
  if (!url) return null

  return {
    ...meta,
    url,
    external: /^https?:\/\//i.test(url)
  }
}
