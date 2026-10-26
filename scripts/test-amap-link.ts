/// <reference types="node" />

/**
 * 高德 MCP 唤端链接解析测试（纯函数，无网络/DB 依赖）
 *
 * 跑法：
 *   npx tsx scripts/test-amap-link.ts
 *
 * 覆盖官方 maps_schema_* 可能返回的形态：纯 URI、JSON、转义斜杠、HTML 实体、
 * 长文案里的链接、App scheme，以及「不能误判」的反例。
 */

import assert from 'node:assert/strict'
import { extractAmapLink, resolveAmapAction } from '../app/utils/amap'

interface LinkCase {
  name: string
  input: string
  expected: string | null
}

const LINK_CASES: LinkCase[] = [
  {
    name: '纯 https 链接',
    input: 'https://uri.amap.com/marker?position=120.1551,30.2741&name=%E8%A5%BF%E6%B9%96&coordinate=gaode&callnative=0',
    expected: 'https://uri.amap.com/marker?position=120.1551,30.2741&name=%E8%A5%BF%E6%B9%96&coordinate=gaode&callnative=0'
  },
  {
    name: 'App scheme',
    input: 'amapuri://route/plan/?dlat=30.2741&dlon=120.1551&dname=%E8%A5%BF%E6%B9%96&dev=0&t=0',
    expected: 'amapuri://route/plan/?dlat=30.2741&dlon=120.1551&dname=%E8%A5%BF%E6%B9%96&dev=0&t=0'
  },
  {
    name: 'JSON 字段 url',
    input: '{"url":"https://uri.amap.com/marker?position=1,2"}',
    expected: 'https://uri.amap.com/marker?position=1,2'
  },
  {
    name: 'JSON 转义斜杠',
    input: '{"uri":"https:\\/\\/surl.amap.com\\/abc123"}',
    expected: 'https://surl.amap.com/abc123'
  },
  {
    name: 'HTML 实体 &amp;',
    input: 'https://uri.amap.com/marker?a=1&amp;b=2',
    expected: 'https://uri.amap.com/marker?a=1&b=2'
  },
  {
    name: '长文案里的高德链接',
    input: `规划完成：https://uri.amap.com/marker?position=1,2 ，点击打开。${'x'.repeat(300)}`,
    expected: 'https://uri.amap.com/marker?position=1,2'
  },
  {
    name: '高德链接优先于文档链接',
    input: `详见 https://example.com/docs，然后打开 https://uri.amap.com/marker?position=1,2 ${'x'.repeat(300)}`,
    expected: 'https://uri.amap.com/marker?position=1,2'
  },
  {
    name: 'URL 后直接跟中文（不能吞字）',
    input: '点击https://uri.amap.com/marker?position=1,2打开地图',
    expected: 'https://uri.amap.com/marker?position=1,2'
  },
  {
    name: '短文案里的第三方链接（兜底）',
    input: 'https://example.com/help',
    expected: 'https://example.com/help'
  },
  {
    name: '长文案里的第三方链接（不误判）',
    input: `出错了，详见 https://example.com/docs ${'x'.repeat(300)}`,
    expected: null
  },
  {
    name: '无链接',
    input: '{"status":"1","count":"0"}',
    expected: null
  }
]

const ACTION_CASES: Array<{
  name: string
  toolName: string
  status: 'running' | 'done' | 'error'
  result?: string
  expectedLabel: string | null
}> = [
  {
    name: '导航工具 done → 按钮',
    toolName: 'gaode__maps_schema_navi',
    status: 'done',
    result: 'https://uri.amap.com/marker?position=1,2',
    expectedLabel: '唤起高德导航'
  },
  {
    name: '行程工具 done → 按钮',
    toolName: 'amap__maps_schema_personal_map',
    status: 'done',
    result: 'https://uri.amap.com/marker?position=1,2',
    expectedLabel: '在地图中打开行程'
  },
  {
    name: '打车工具 done → 按钮',
    toolName: 'gaode__maps_schema_take_taxi',
    status: 'done',
    result: 'amapuri://taxi?dname=x',
    expectedLabel: '在高德中打车'
  },
  {
    name: 'running 不出按钮',
    toolName: 'gaode__maps_schema_navi',
    status: 'running',
    result: 'https://uri.amap.com/marker?position=1,2',
    expectedLabel: null
  },
  {
    name: 'error 不出按钮',
    toolName: 'gaode__maps_schema_navi',
    status: 'error',
    result: 'https://uri.amap.com/marker?position=1,2',
    expectedLabel: null
  },
  {
    name: '普通工具不出按钮',
    toolName: 'gaode__maps_direction_driving',
    status: 'done',
    result: 'https://uri.amap.com/marker?position=1,2',
    expectedLabel: null
  },
  {
    name: 'schema 工具但无链接',
    toolName: 'gaode__maps_schema_navi',
    status: 'done',
    result: '{"status":"0","info":"INVALID_PARAMS"}',
    expectedLabel: null
  }
]

let failures = 0

for (const item of LINK_CASES) {
  const actual = extractAmapLink(item.input)
  try {
    assert.equal(actual, item.expected)
    console.log(`✅ ${item.name}`)
  } catch {
    failures++
    console.error(`❌ ${item.name}\n   期望: ${item.expected}\n   实际: ${actual}`)
  }
}

for (const item of ACTION_CASES) {
  const actual = resolveAmapAction(item.toolName, item.status, item.result)
  try {
    assert.equal(actual?.label ?? null, item.expectedLabel)
    console.log(`✅ ${item.name}`)
  } catch {
    failures++
    console.error(`❌ ${item.name}\n   期望: ${item.expectedLabel}\n   实际: ${actual?.label ?? null}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} 个用例失败`)
  process.exit(1)
}

console.log(`\n全部 ${LINK_CASES.length + ACTION_CASES.length} 个用例通过`)
