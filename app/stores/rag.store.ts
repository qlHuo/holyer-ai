/**
 * RAG 知识库 store — 知识库列表 + 当前库文档列表
 *
 * 分两态：
 * - 知识库态（一级页 /rag）：kbList / loading / loadError
 * - 文档态（二级页 /rag/:id）：currentKbId + documents / docsLoading / docsError
 *
 * kbOptions 供聊天选库器复用（届时镜像 ChatModelSelector 接入）。
 */
import { ref } from 'vue'
import type {
  KnowledgeBase,
  CreateKnowledgeBaseInput,
  DocumentSummary,
  UploadDocumentInput
} from '~~/shared/types/rag'
import RagApi from '~/api/rag'

export const useRagStore = defineStore('rag', () => {
  // ==================== 知识库态 ====================

  const kbList = ref<Array<KnowledgeBase>>([])
  const loading = ref(false)
  const loadError = ref<string | null>(null)

  // ==================== 文档态 ====================

  /** 当前选中的知识库 id（二级页进入时设置） */
  const currentKbId = ref<string | null>(null)
  const documents = ref<Array<DocumentSummary>>([])
  const docsLoading = ref(false)
  const docsError = ref<string | null>(null)

  // ==================== 知识库操作 ====================

  /** 获取知识库列表（防重入 + 三态） */
  async function getKBs() {
    if (loading.value) return
    loading.value = true
    loadError.value = null
    try {
      const data = await RagApi.getKnowledgeBases()
      kbList.value = data
      loadError.value = null
    } catch (error: any) {
      loadError.value = error?.message || '加载知识库失败'
    } finally {
      loading.value = false
    }
  }

  /** 创建知识库（新增插到列表头） */
  async function createKB(data: CreateKnowledgeBaseInput) {
    const detail = await RagApi.createKnowledgeBase(data)
    kbList.value.unshift(detail)
  }

  /** 更新知识库（map 替换；返回的单对象 docCount 恒为 0，此处保留原列表项计数不覆盖） */
  async function updateKB(id: string, data: CreateKnowledgeBaseInput) {
    const detail = await RagApi.updateKnowledgeBase(id, data)
    if (!detail) return
    kbList.value = kbList.value.map(item => item.id === id ? { ...detail, docCount: item.docCount } : item)
  }

  /** 删除知识库（级联删文档+向量；若为当前库则清空选中） */
  async function removeKB(id: string) {
    const result = await RagApi.deleteKnowledgeBase(id)
    if (result) {
      kbList.value = kbList.value.filter(item => item.id !== id)
      if (currentKbId.value === id) {
        currentKbId.value = null
        documents.value = []
      }
    }
  }

  // ==================== 文档操作 ====================

  /** 设置当前库（二级页进入时） */
  function setCurrentKbId(id: string) {
    currentKbId.value = id
  }

  /** 加载某库文档列表（防重入 + 三态） */
  async function loadDocuments(kbId: string) {
    if (docsLoading.value) return
    docsLoading.value = true
    docsError.value = null
    try {
      const data = await RagApi.getDocuments(kbId)
      documents.value = data
      docsError.value = null
    } catch (error: any) {
      docsError.value = error?.message || '加载文档失败'
    } finally {
      docsLoading.value = false
    }
  }

  /** 上传文档（成功后当前库列表头部插入新文档） */
  async function uploadDocument(input: UploadDocumentInput) {
    const result = await RagApi.uploadDocument(input)
    if (currentKbId.value === input.kbId) {
      documents.value.unshift(result.document)
    }
    return result
  }

  /** 删除文档 */
  async function removeDocument(id: string) {
    const result = await RagApi.deleteDocument(id)
    if (result) {
      documents.value = documents.value.filter(item => item.id !== id)
    }
  }

  /** 下载原始 .md：拉详情原文 → 触发浏览器下载 */
  async function downloadDocument(doc: DocumentSummary) {
    const detail = await RagApi.getDocumentDetail(doc.id)
    const fileName = doc.title.endsWith('.md') ? doc.title : `${doc.title}.md`
    const blob = new Blob([detail.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  // ==================== 派生 ====================

  /** 知识库下拉选项（供聊天选库器复用） */
  const kbOptions = computed(() => {
    return kbList.value.map(kb => ({
      label: kb.name,
      value: kb.id
    }))
  })

  /** 当前库对象（二级页标题栏显示用） */
  const activeKb = computed(() => {
    return kbList.value.find(kb => kb.id === currentKbId.value) ?? null
  })

  return {
    kbList,
    loading,
    loadError,
    currentKbId,
    documents,
    docsLoading,
    docsError,
    kbOptions,
    activeKb,
    getKBs,
    createKB,
    updateKB,
    removeKB,
    setCurrentKbId,
    loadDocuments,
    uploadDocument,
    removeDocument,
    downloadDocument
  }
})
