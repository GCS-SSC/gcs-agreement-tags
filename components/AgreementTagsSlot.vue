<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig } from '@gcs-ssc/extensions'
import {
  makePredefinedTagValue,
  normalizeAgreementTagsConfig,
  rankTagsByKeywordOverlap,
  resolveAgreementTagsDescriptionsContext,
  tagValueKey
} from './agreement-tags'
import type { AgreementTagSuggestion, AgreementTagValue } from './agreement-tags'

interface WorkerMessage {
  kind?: 'result' | 'error'
  requestId?: number
  suggestions?: AgreementTagSuggestion[]
  error?: string
}

const SCORE_REQUEST_DEBOUNCE_MS = 500
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

const normalizedConfig = computed(() => normalizeAgreementTagsConfig(config))
const descriptionsContext = computed(() => resolveAgreementTagsDescriptionsContext(context))
const tagByKey = computed(() => new Map(normalizedConfig.value.tags.map(tag => [tag.key, tag])))
const predefinedOptions = computed(() => normalizedConfig.value.tags.map(tag => makePredefinedTagValue(tag, locale.value === 'fr' ? 'fr' : 'en')))

const selectedTags: Ref<AgreementTagValue[]> = ref([])
const suggestions: Ref<AgreementTagSuggestion[]> = ref([])
const isLoading: Ref<boolean> = ref(false)
const error: Ref<string> = ref('')
const latestRequestId: Ref<number> = ref(0)
const pendingTimer: Ref<ReturnType<typeof setTimeout> | null> = ref(null)
const unsubscribeWorker: Ref<(() => void) | null> = ref(null)

const labels = {
  title: { en: 'Suggested tags', fr: 'Étiquettes suggérées' },
  unavailable: { en: 'Tag suggestions unavailable', fr: 'Suggestions d’étiquettes indisponibles' },
  select: { en: 'Select tags', fr: 'Sélectionner les étiquettes' },
  customPlaceholder: { en: 'Add custom tags', fr: 'Ajouter des étiquettes personnalisées' },
  noAgreement: { en: 'Save the agreement to persist tags.', fr: 'Enregistrez l’entente pour conserver les étiquettes.' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const shouldRender = computed(() =>
  normalizedConfig.value.enabled
  && Boolean(descriptionsContext.value)
  && normalizedConfig.value.tags.length > 0
)

const tagLabel = (key: string) => {
  const tag = tagByKey.value.get(key)
  if (!tag) {
    return key
  }

  return locale.value === 'fr' ? tag.label.fr : tag.label.en
}

const tagColor = (tag: AgreementTagValue) => tag.predefined
  ? tagByKey.value.get(tag.key)?.color ?? 'neutral'
  : 'neutral'

const normalizeInputTagLabel = (value: string) => value.trim().replace(/\s+/g, ' ')

const predefinedTagByInputLabel = computed(() => {
  const items = new Map<string, AgreementTagValue>()
  for (const tag of normalizedConfig.value.tags) {
    const predefinedTag = makePredefinedTagValue(tag, locale.value === 'fr' ? 'fr' : 'en')
    items.set(normalizeInputTagLabel(predefinedTag.label).toLowerCase(), predefinedTag)
  }

  return items
})

const selectedPredefinedTagKeys = computed(() => new Set(
  selectedTags.value.flatMap(tag => tag.predefined ? [tag.key] : [])
))
const suggestionItems = computed(() => suggestions.value.filter(item =>
  tagByKey.value.has(item.key) && !selectedPredefinedTagKeys.value.has(item.key)
))
const tagInputLabels = computed(() => selectedTags.value.map(tag => tag.label))
const isPredefinedTagLabel = (label: string) => predefinedTagByInputLabel.value.has(normalizeInputTagLabel(label).toLowerCase())

const routeUrl = computed(() => {
  const ctx = descriptionsContext.value
  if (!ctx?.streamId || !ctx.agreementId) {
    return ''
  }

  return `/api/extensions/gcs-agreement-tags/streams/${encodeURIComponent(ctx.streamId)}/agreements/${encodeURIComponent(ctx.agreementId)}/tags`
})

const loadPersistedTags = async () => {
  if (!routeUrl.value) {
    selectedTags.value = []
    error.value = ''
    return
  }

  try {
    const response = await $fetch<{ tags: AgreementTagValue[] }>(routeUrl.value)
    selectedTags.value = response.tags.filter(tag => !tag.predefined || tagByKey.value.has(tag.key))
  } catch (caughtError: unknown) {
    selectedTags.value = []
    error.value = caughtError instanceof Error ? caughtError.message : text('unavailable')
  }
}

const handleWorkerMessage = (message: WorkerMessage) => {
  if (message.requestId !== latestRequestId.value) {
    return
  }

  isLoading.value = false
  if (message.kind === 'error') {
    error.value = message.error || text('unavailable')
    const ctx = descriptionsContext.value
    suggestions.value = ctx
      ? rankTagsByKeywordOverlap(ctx.descriptions?.en ?? '', normalizedConfig.value.tags, normalizedConfig.value.maxSuggestions)
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
  const ctx = descriptionsContext.value
  const descriptionEn = ctx?.descriptions?.en ?? ''
  if (!shouldRender.value || !descriptionEn) {
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
    try {
      getSharedWorker().postMessage({
        type: 'suggest',
        requestId,
        payload: {
          text: descriptionEn,
          minScore: normalizedConfig.value.minScore,
          maxSuggestions: normalizedConfig.value.maxSuggestions,
          tags: normalizedConfig.value.tags
        }
      })
    } catch (caughtError: unknown) {
      isLoading.value = false
      error.value = caughtError instanceof Error ? caughtError.message : text('unavailable')
      suggestions.value = rankTagsByKeywordOverlap(descriptionEn, normalizedConfig.value.tags, normalizedConfig.value.maxSuggestions)
    }
  }, SCORE_REQUEST_DEBOUNCE_MS)
}

const addSuggestion = (key: string) => {
  const tag = tagByKey.value.get(key)
  if (!tag) {
    return
  }

  const nextTag = makePredefinedTagValue(tag, locale.value === 'fr' ? 'fr' : 'en')
  if (selectedTags.value.some(item => tagValueKey(item) === tagValueKey(nextTag))) {
    return
  }

  selectedTags.value = [...selectedTags.value, nextTag]
}

const updateTagInputValues = (labels: string[]) => {
  const seenKeys = new Set<string>()
  const nextTags = labels.flatMap(label => {
    const normalizedLabel = normalizeInputTagLabel(label)
    if (!normalizedLabel) {
      return []
    }

    const predefinedTag = predefinedTagByInputLabel.value.get(normalizedLabel.toLowerCase())
    const nextTag = predefinedTag ?? {
      predefined: false as const,
      label: normalizedLabel
    }
    const key = tagValueKey(nextTag)
    if (seenKeys.has(key)) {
      return []
    }

    seenKeys.add(key)
    return [nextTag]
  })

  selectedTags.value = nextTags
}

const syncTagsToAgreementPayload = () => {
  const ctx = descriptionsContext.value
  if (!ctx?.setExtensionPayload) {
    return
  }

  ctx.setExtensionPayload('gcs-agreement-tags', 'agreementDescriptionTags', selectedTags.value)
}

unsubscribeWorker.value = subscribeToSharedWorker(handleWorkerMessage)

watch(() => [routeUrl.value, normalizedConfig.value.tags.map(tag => tag.key).join('|')], () => {
  void loadPersistedTags()
}, { immediate: true })

watch(() => ({
  text: descriptionsContext.value?.descriptions?.en ?? '',
  keys: normalizedConfig.value.tags.map(tag => tag.key).join('|'),
  enabled: normalizedConfig.value.enabled
}), scheduleSuggestions, { immediate: true, deep: true })

watch(selectedTags, syncTagsToAgreementPayload, { deep: true })

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
      <div
        v-if="isLoading"
        class="inline-flex items-center gap-1"
        :aria-label="text('title')"
        role="status">
        <span class="plugin-runtime-activity-dot" />
        <span class="plugin-runtime-activity-dot plugin-runtime-activity-dot--delayed" />
        <span class="plugin-runtime-activity-dot plugin-runtime-activity-dot--late" />
      </div>
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

    <div class="space-y-2">
      <USelectMenu
        v-if="!normalizedConfig.allowCustomTags"
        v-model="selectedTags"
        multiple
        label-key="label"
        :items="predefinedOptions"
        :placeholder="text('select')"
        class="w-full">
        <template #default="{ modelValue }">
          <div v-if="Array.isArray(modelValue) && modelValue.length > 0" class="flex flex-wrap gap-1">
            <UBadge
              v-for="tag in modelValue"
              :key="tagValueKey(tag)"
              :color="tagColor(tag)"
              variant="subtle">
              {{ tag.label }}
            </UBadge>
          </div>
        </template>
      </USelectMenu>

      <div v-else>
        <UInputTags
          :model-value="tagInputLabels"
          :add-on-blur="true"
          :placeholder="text('customPlaceholder')"
          class="agreement-tag-input w-full"
          @update:model-value="updateTagInputValues">
          <template #item-text="{ item }">
            <span
              :class="isPredefinedTagLabel(String(item)) ? 'agreement-tag-input__predefined' : 'agreement-tag-input__custom'">
              {{ item }}
            </span>
          </template>
        </UInputTags>
      </div>
    </div>

    <p v-if="!routeUrl" class="text-xs text-zinc-500 dark:text-zinc-400">
      {{ text('noAgreement') }}
    </p>
  </div>
</template>

<style scoped>
.plugin-runtime-activity-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: var(--ui-primary);
  animation: plugin-runtime-activity-bounce 1s infinite ease-in-out;
}

.plugin-runtime-activity-dot--delayed {
  animation-delay: -0.2s;
}

.plugin-runtime-activity-dot--late {
  animation-delay: -0.1s;
}

.agreement-tag-input :deep([data-slot="item"]:has(.agreement-tag-input__predefined)) {
  border-color: color-mix(in oklab, var(--ui-primary) 55%, transparent);
  background: color-mix(in oklab, var(--ui-primary) 18%, transparent);
  color: var(--ui-primary);
}

.agreement-tag-input :deep([data-slot="item"]:has(.agreement-tag-input__custom)) {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
}

@keyframes plugin-runtime-activity-bounce {
  0%, 80%, 100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
