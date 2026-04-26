<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig } from '@gcs-ssc/extensions'
import {
  getNarrativeTagsTargetConfig,
  makePredefinedTagValue,
  normalizeNarrativeTagKey,
  normalizeNarrativeTagsConfig,
  rankTagsByKeywordOverlap,
  resolveNarrativeTagsEntityTarget,
  tagValueKey
} from './narrative-tags'
import type { NarrativeTagSuggestion, NarrativeTagValue } from './narrative-tags'

interface WorkerMessage {
  kind?: 'result' | 'error'
  requestId?: number
  suggestions?: NarrativeTagSuggestion[]
  error?: string
}

const SCORE_REQUEST_DEBOUNCE_MS = 500
const SHARED_WORKER_STATE_KEY = '__gcsNarrativeTagsWorkerState'

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
    state.worker = new Worker('/extensions/gcs-narrative-tags/client/worker.js', { type: 'module' })
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

const normalizedConfig = computed(() => normalizeNarrativeTagsConfig(config))
const entityTarget = computed(() => resolveNarrativeTagsEntityTarget(context))
const targetConfig = computed(() => {
  const target = entityTarget.value
  return target ? getNarrativeTagsTargetConfig(normalizedConfig.value, target.targetKey) : null
})
const tagByKey = computed(() => new Map(normalizedConfig.value.tags.map(tag => [tag.key, tag])))
const activeLocale = computed(() => locale.value === 'fr' ? 'fr' : 'en')
const predefinedOptions = computed(() => normalizedConfig.value.tags.map(tag => makePredefinedTagValue(tag, activeLocale.value)))

const selectedTags: Ref<NarrativeTagValue[]> = ref([])
const suggestions: Ref<NarrativeTagSuggestion[]> = ref([])
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
  noAgreement: { en: 'Save this record to persist tags.', fr: 'Enregistrez cet enregistrement pour conserver les étiquettes.' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const shouldRender = computed(() =>
  normalizedConfig.value.enabled
  && Boolean(entityTarget.value)
  && targetConfig.value?.enabled === true
  && normalizedConfig.value.tags.length > 0
)

const tagLabel = (key: string) => {
  const tag = tagByKey.value.get(key)
  if (!tag) {
    return key
  }

  return activeLocale.value === 'fr' ? tag.label.fr : tag.label.en
}

const suggestionLabel = (suggestion: NarrativeTagSuggestion) =>
  suggestion.predefined === false ? suggestion.label : tagLabel(suggestion.key)

const normalizeInputTagLabel = (value: string) => value.trim().replace(/\s+/g, ' ')

const predefinedTagByInputLabel = computed(() => {
  const items = new Map<string, NarrativeTagValue>()
  for (const tag of normalizedConfig.value.tags) {
    const predefinedTag = makePredefinedTagValue(tag, activeLocale.value)
    items.set(normalizeInputTagLabel(predefinedTag.label).toLowerCase(), predefinedTag)
  }

  return items
})

const selectedPredefinedTagKeys = computed(() => new Set(
  selectedTags.value.flatMap(tag => tag.predefined ? [tag.key] : [])
))
const suggestionItems = computed(() => suggestions.value.filter(item =>
  item.predefined === false
    ? targetConfig.value?.allowCustomTags === true && !selectedTags.value.some(tag => !tag.predefined && normalizeNarrativeTagKey(tag.label) === normalizeNarrativeTagKey(item.label))
    : tagByKey.value.has(item.key) && !selectedPredefinedTagKeys.value.has(item.key)
))
const tagInputLabels = computed(() => selectedTags.value.map(tag => tag.label))
const isPredefinedTagLabel = (label: string) => predefinedTagByInputLabel.value.has(normalizeInputTagLabel(label).toLowerCase())

const routeUrl = computed(() => {
  const target = entityTarget.value
  if (!target) {
    return ''
  }

  if (target.targetKey === 'agreement.description' && target.streamId && target.ownerId) {
    return `/api/extensions/gcs-narrative-tags/streams/${encodeURIComponent(target.streamId)}/agreements/${encodeURIComponent(target.ownerId)}/tags`
  }

  if (target.targetKey === 'proponent.description' && target.agencyId && target.ownerId) {
    return `/api/extensions/gcs-narrative-tags/agencies/${encodeURIComponent(target.agencyId)}/applicant-recipients/${encodeURIComponent(target.ownerId)}/tags`
  }

  return ''
})

const fieldStorageKey = computed(() => {
  const target = entityTarget.value
  return target ? target.targetKey : ''
})

const loadPersistedTags = async () => {
  if (!routeUrl.value) {
    const target = entityTarget.value
    const payload = target?.extensions['gcs-narrative-tags']
    const currentTextFieldTags = payload?.textFieldTags && typeof payload.textFieldTags === 'object'
      ? payload.textFieldTags as Record<string, unknown>
      : {}
    const tags = fieldStorageKey.value ? currentTextFieldTags[fieldStorageKey.value] : []
    selectedTags.value = Array.isArray(tags)
      ? tags.filter((tag): tag is NarrativeTagValue => typeof tag === 'object' && tag !== null && (!('key' in tag) || tagByKey.value.has(String(tag.key))))
      : []
    error.value = ''
    return
  }

  try {
    const response = await $fetch<{ tags: NarrativeTagValue[]; textFieldTags?: Record<string, NarrativeTagValue[]> }>(routeUrl.value)
    const tags = fieldStorageKey.value && response.textFieldTags
      ? response.textFieldTags[fieldStorageKey.value] ?? response.tags
      : response.tags
    selectedTags.value = tags.filter(tag => !tag.predefined || tagByKey.value.has(tag.key))
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
    const target = entityTarget.value
    suggestions.value = target
      ? rankTagsByKeywordOverlap(target.text, normalizedConfig.value.tags, targetConfig.value?.maxSuggestions ?? 0)
      : []
    return
  }

  const configForTarget = targetConfig.value
  suggestions.value = (message.suggestions ?? [])
    .filter(item => item.predefined === false ? item.score >= (configForTarget?.minDynamicScore ?? 1) : item.score >= (configForTarget?.minScore ?? 1))
    .slice(0, (configForTarget?.maxSuggestions ?? 0) + (configForTarget?.maxDynamicTags ?? 0))
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
  const target = entityTarget.value
  const targetText = target?.text ?? ''
  const configForTarget = targetConfig.value
  if (!shouldRender.value || !targetText) {
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
          text: targetText,
          locale: activeLocale.value,
          minScore: configForTarget?.minScore ?? 1,
          maxSuggestions: configForTarget?.maxSuggestions ?? 0,
          allowDynamicTagSuggestions: configForTarget?.allowDynamicTagSuggestions === true,
          minDynamicScore: configForTarget?.minDynamicScore ?? 1,
          maxDynamicTags: configForTarget?.maxDynamicTags ?? 0,
          dynamicNgramMin: configForTarget?.dynamicNgramMin ?? 1,
          dynamicNgramMax: configForTarget?.dynamicNgramMax ?? 1,
          semanticWeight: configForTarget?.semanticWeight ?? 0,
          lexicalWeight: configForTarget?.lexicalWeight ?? 0,
          exactAliasBoost: configForTarget?.exactAliasBoost ?? 0,
          negationPenalty: configForTarget?.negationPenalty ?? 0,
          negationWindow: configForTarget?.negationWindow ?? 0,
          useEmbeddingCache: configForTarget?.useEmbeddingCache === true,
          useBrowserCache: configForTarget?.useBrowserCache === true,
          tags: normalizedConfig.value.tags
        }
      })
    } catch (caughtError: unknown) {
      isLoading.value = false
      error.value = caughtError instanceof Error ? caughtError.message : text('unavailable')
      suggestions.value = rankTagsByKeywordOverlap(targetText, normalizedConfig.value.tags, configForTarget?.maxSuggestions ?? 0)
    }
  }, SCORE_REQUEST_DEBOUNCE_MS)
}

const addSuggestion = (key: string) => {
  const tag = tagByKey.value.get(key)
  if (!tag) {
    return
  }

  const nextTag = makePredefinedTagValue(tag, activeLocale.value)
  if (selectedTags.value.some(item => tagValueKey(item) === tagValueKey(nextTag))) {
    return
  }

  selectedTags.value = [...selectedTags.value, nextTag]
}

const addDynamicSuggestion = (label: string) => {
  if (targetConfig.value?.allowCustomTags !== true) {
    return
  }

  const nextTag: NarrativeTagValue = {
    predefined: false,
    label: normalizeInputTagLabel(label)
  }
  if (!nextTag.label || selectedTags.value.some(item => tagValueKey(item) === tagValueKey(nextTag))) {
    return
  }

  selectedTags.value = [...selectedTags.value, nextTag]
}

const addSuggestedTag = (suggestion: NarrativeTagSuggestion) => {
  if (suggestion.predefined === false) {
    addDynamicSuggestion(suggestion.label)
    return
  }

  addSuggestion(suggestion.key)
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
  const target = entityTarget.value
  if (!target?.setExtensionPayload || !fieldStorageKey.value) {
    return
  }

  const extensionPayload = target.extensions['gcs-narrative-tags'] ?? {}
  const currentTextFieldTags = extensionPayload.textFieldTags && typeof extensionPayload.textFieldTags === 'object'
    ? extensionPayload.textFieldTags as Record<string, unknown>
    : {}

  target.setExtensionPayload('gcs-narrative-tags', 'textFieldTags', {
    ...currentTextFieldTags,
    [fieldStorageKey.value]: selectedTags.value
  })

  if (target.targetKey === 'agreement.description') {
    target.setExtensionPayload('gcs-narrative-tags', 'agreementDescriptionTags', selectedTags.value)
  }
}

unsubscribeWorker.value = subscribeToSharedWorker(handleWorkerMessage)

watch(() => [routeUrl.value, normalizedConfig.value.tags.map(tag => tag.key).join('|')], () => {
  void loadPersistedTags()
}, { immediate: true })

watch(() => ({
  text: entityTarget.value?.text ?? '',
  target: entityTarget.value?.targetKey ?? '',
  locale: activeLocale.value,
  keys: normalizedConfig.value.tags.map(tag => tag.key).join('|'),
  enabled: normalizedConfig.value.enabled,
  targetEnabled: targetConfig.value?.enabled === true,
  targetCustom: targetConfig.value?.allowCustomTags === true,
  targetDynamic: targetConfig.value?.allowDynamicTagSuggestions === true,
  targetScore: targetConfig.value?.minScore ?? 0,
  targetDynamicScore: targetConfig.value?.minDynamicScore ?? 0,
  targetSuggestions: targetConfig.value?.maxSuggestions ?? 0,
  targetDynamicTags: targetConfig.value?.maxDynamicTags ?? 0
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
        :key="suggestion.predefined === false ? normalizeNarrativeTagKey(suggestion.label) : suggestion.key"
        color="neutral"
        variant="outline"
        size="sm"
        class="cursor-default"
        icon="i-lucide-plus"
        :label="suggestionLabel(suggestion)"
        @click="addSuggestedTag(suggestion)" />
    </div>

    <div class="space-y-2">
      <USelectMenu
        v-if="targetConfig?.allowCustomTags !== true"
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
              color="neutral"
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
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
}

.agreement-tag-input :deep([data-slot="item"]:has(.agreement-tag-input__custom)) {
  border-color: color-mix(in oklab, var(--ui-primary) 55%, transparent);
  background: color-mix(in oklab, var(--ui-primary) 18%, transparent);
  color: var(--ui-primary);
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
