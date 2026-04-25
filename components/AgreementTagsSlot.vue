<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig } from '@gcs-ssc/extensions'
import {
  normalizeAgreementTagsConfig,
  rankTagsByKeywordOverlap,
  resolveAgreementTagsTextareaContext
} from './agreement-tags'
import type { AgreementTagSuggestion } from './agreement-tags'

interface WorkerMessage {
  kind?: 'result' | 'error'
  requestId?: number
  suggestions?: AgreementTagSuggestion[]
  error?: string
}

const SCORE_REQUEST_DEBOUNCE_MS = 450
const SHARED_WORKER_STATE_KEY = '__gcsAgreementTagsWorkerState'

interface SharedWorkerState {
  worker: Worker | null
  requestId: number
  listeners: Set<(message: WorkerMessage) => void>
}

const getSharedWorkerState = (): SharedWorkerState => {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_WORKER_STATE_KEY]?: SharedWorkerState
  }

  if (!globalScope[SHARED_WORKER_STATE_KEY]) {
    globalScope[SHARED_WORKER_STATE_KEY] = {
      worker: null,
      requestId: 1,
      listeners: new Set()
    }
  }

  return globalScope[SHARED_WORKER_STATE_KEY]
}

const getSharedWorker = () => {
  const state = getSharedWorkerState()
  if (!state.worker) {
    state.worker = new Worker('/extensions/gcs-agreement-tags/client/worker.js', { type: 'module' })
    state.worker.addEventListener('message', event => {
      const message = event.data as WorkerMessage
      for (const listener of state.listeners) {
        listener(message)
      }
    })
  }

  return state.worker
}

const subscribeToSharedWorker = (listener: (message: WorkerMessage) => void) => {
  const state = getSharedWorkerState()
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}

const createSharedRequestId = () => {
  const state = getSharedWorkerState()
  const requestId = state.requestId
  state.requestId += 1
  return requestId
}

const {
  config,
  context = {}
} = defineProps<{
  config: GcsExtensionJsonConfig
  context?: Record<string, unknown>
}>()

const { locale } = useI18n()
const toast = useToast()

const normalizedConfig = computed(() => normalizeAgreementTagsConfig(config))
const textareaContext = computed(() => resolveAgreementTagsTextareaContext(context))
const tagByKey = computed(() => new Map(normalizedConfig.value.tags.map(tag => [tag.key, tag])))
const options = computed(() => normalizedConfig.value.tags.map(tag => ({
  label: locale.value === 'fr' ? tag.label.fr : tag.label.en,
  value: tag.key
})))

const selectedTags: Ref<string[]> = ref([])
const suggestions: Ref<AgreementTagSuggestion[]> = ref([])
const isLoading: Ref<boolean> = ref(false)
const isSaving: Ref<boolean> = ref(false)
const error: Ref<string> = ref('')
const latestRequestId: Ref<number> = ref(0)
const pendingTimer: Ref<ReturnType<typeof setTimeout> | null> = ref(null)
const unsubscribeWorker: Ref<(() => void) | null> = ref(null)

const labels = {
  title: { en: 'Suggested tags', fr: 'Étiquettes suggérées' },
  unavailable: { en: 'Tag suggestions unavailable', fr: 'Suggestions d’étiquettes indisponibles' },
  save: { en: 'Save tags', fr: 'Enregistrer les étiquettes' },
  saved: { en: 'Tags saved', fr: 'Étiquettes enregistrées' },
  select: { en: 'Select tags', fr: 'Sélectionner les étiquettes' },
  noAgreement: { en: 'Save the agreement before persisting tags.', fr: 'Enregistrez l’entente avant de conserver les étiquettes.' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const shouldRender = computed(() =>
  normalizedConfig.value.enabled
  && Boolean(textareaContext.value)
  && normalizedConfig.value.tags.length > 0
)

const tagLabel = (key: string) => {
  const tag = tagByKey.value.get(key)
  if (!tag) {
    return key
  }

  return locale.value === 'fr' ? tag.label.fr : tag.label.en
}

const tagColor = (key: string) => tagByKey.value.get(key)?.color ?? 'neutral'

const suggestionItems = computed(() => suggestions.value.filter(item => tagByKey.value.has(item.key)))

const routeUrl = computed(() => {
  const ctx = textareaContext.value
  if (!ctx?.streamId || !ctx.agreementId) {
    return ''
  }

  return `/api/extensions/gcs-agreement-tags/streams/${ctx.streamId}/agreements/${ctx.agreementId}/tags`
})

const loadPersistedTags = async () => {
  if (!routeUrl.value) {
    selectedTags.value = []
    return
  }

  try {
    const response = await $fetch<{ tags: string[] }>(routeUrl.value)
    selectedTags.value = response.tags.filter(key => tagByKey.value.has(key))
  } catch {
    selectedTags.value = []
  }
}

const handleWorkerMessage = (message: WorkerMessage) => {
  if (message.requestId !== latestRequestId.value) {
    return
  }

  isLoading.value = false
  if (message.kind === 'error') {
    error.value = message.error || text('unavailable')
    const ctx = textareaContext.value
    suggestions.value = ctx
      ? rankTagsByKeywordOverlap(ctx.text ?? '', normalizedConfig.value.tags, normalizedConfig.value.maxSuggestions)
      : []
    return
  }

  suggestions.value = (message.suggestions ?? [])
    .filter(item => item.score >= normalizedConfig.value.minScore)
    .slice(0, normalizedConfig.value.maxSuggestions)
  error.value = ''
}

const clearPendingTimer = () => {
  if (pendingTimer.value) {
    clearTimeout(pendingTimer.value)
    pendingTimer.value = null
  }
}

const scheduleSuggestions = () => {
  clearPendingTimer()
  const ctx = textareaContext.value
  if (!shouldRender.value || !ctx?.text) {
    suggestions.value = []
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = ''
  const requestId = createSharedRequestId()
  latestRequestId.value = requestId
  pendingTimer.value = setTimeout(() => {
    pendingTimer.value = null
    getSharedWorker().postMessage({
      type: 'suggest',
      requestId,
      payload: {
        text: ctx.text,
        minScore: normalizedConfig.value.minScore,
        maxSuggestions: normalizedConfig.value.maxSuggestions,
        tags: normalizedConfig.value.tags
      }
    })
  }, SCORE_REQUEST_DEBOUNCE_MS)
}

const addSuggestion = (key: string) => {
  if (selectedTags.value.includes(key)) {
    return
  }

  selectedTags.value = [...selectedTags.value, key]
}

const saveTags = async () => {
  if (!routeUrl.value || isSaving.value) {
    return
  }

  try {
    isSaving.value = true
    await $fetch(routeUrl.value, {
      method: 'PATCH',
      body: {
        tags: selectedTags.value
      }
    })
    toast.add({ title: text('saved'), color: 'success' })
  } catch (caughtError: unknown) {
    error.value = caughtError instanceof Error ? caughtError.message : text('unavailable')
  } finally {
    isSaving.value = false
  }
}

unsubscribeWorker.value = subscribeToSharedWorker(handleWorkerMessage)

watch(() => [routeUrl.value, normalizedConfig.value.tags.map(tag => tag.key).join('|')], () => {
  void loadPersistedTags()
}, { immediate: true })

watch(() => ({
  text: textareaContext.value?.text ?? '',
  keys: normalizedConfig.value.tags.map(tag => tag.key).join('|'),
  enabled: normalizedConfig.value.enabled
}), scheduleSuggestions, { immediate: true, deep: true })

onBeforeUnmount(() => {
  clearPendingTimer()
  if (unsubscribeWorker.value) {
    unsubscribeWorker.value()
  }
})
</script>

<template>
  <div v-if="shouldRender" class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-zinc-900 dark:text-white">
        {{ text('title') }}
      </span>
      <UBadge v-if="isLoading" color="neutral" variant="subtle">
        {{ text('title') }}
      </UBadge>
      <UBadge v-if="error" color="warning" variant="subtle">
        {{ text('unavailable') }}
      </UBadge>
    </div>

    <div v-if="suggestionItems.length > 0" class="flex flex-wrap gap-2">
      <UButton
        v-for="suggestion in suggestionItems"
        :key="suggestion.key"
        color="neutral"
        variant="outline"
        size="sm"
        class="cursor-default"
        icon="i-lucide-plus"
        :label="tagLabel(suggestion.key)"
        @click="addSuggestion(suggestion.key)" />
    </div>

    <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
      <USelectMenu
        v-model="selectedTags"
        multiple
        value-key="value"
        label-key="label"
        :items="options"
        :placeholder="text('select')"
        class="w-full">
        <template #default="{ modelValue }">
          <div v-if="Array.isArray(modelValue) && modelValue.length > 0" class="flex flex-wrap gap-1">
            <UBadge
              v-for="key in modelValue"
              :key="key"
              :color="tagColor(String(key))"
              variant="subtle">
              {{ tagLabel(String(key)) }}
            </UBadge>
          </div>
        </template>
      </USelectMenu>

      <CommonSaveButton
        :label="text('save')"
        :loading="isSaving"
        :disabled="isSaving || !routeUrl"
        @click="saveTags" />
    </div>

    <p v-if="!routeUrl" class="text-xs text-zinc-500 dark:text-zinc-400">
      {{ text('noAgreement') }}
    </p>
  </div>
</template>
