<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { GCS_TEXTAREA_TARGETS } from '@gcs-ssc/extensions'
import type { GcsTextareaKnownTargetKey, JsonValue } from '@gcs-ssc/extensions'
import {
  AGREEMENT_TAG_COLORS,
  getNarrativeTagsTargetConfig,
  normalizeNarrativeTagKey,
  normalizeNarrativeTagsConfig,
  toNarrativeTagsJson
} from './narrative-tags'
import type { NarrativeTagDefinition, NarrativeTagsConfig, NarrativeTagsTargetConfig, NarrativeTagLocale } from './narrative-tags'

const model = defineModel<Record<string, JsonValue>>({
  default: () => ({})
})

const { locale } = useI18n()

const state: Ref<NarrativeTagsConfig> = ref(normalizeNarrativeTagsConfig(model.value))
const activeTarget: Ref<GcsTextareaKnownTargetKey> = ref('agreement.description')

const labels = {
  title: { en: 'Narrative tag setup', fr: 'Configuration des étiquettes narratives' },
  description: {
    en: 'Configure the text fields and predefined tag vocabulary used for tag suggestions.',
    fr: 'Configurez les champs texte et le vocabulaire prédéfini utilisés pour les suggestions d’étiquettes.'
  },
  targetFields: { en: 'Target field', fr: 'Champ ciblé' },
  targetDescription: {
    en: 'Choose which narrative field this configuration applies to before editing the suggestion settings.',
    fr: 'Choisissez le champ narratif auquel cette configuration s’applique avant de modifier les paramètres de suggestion.'
  },
  target: { en: 'Target', fr: 'Cible' },
  enabled: { en: 'Enable tag suggestions for this target', fr: 'Activer les suggestions d’étiquettes pour cette cible' },
  allowCustomTags: { en: 'Allow custom tags', fr: 'Autoriser les étiquettes personnalisées' },
  allowDynamicTagSuggestions: { en: 'Suggest dynamic tags', fr: 'Suggérer des étiquettes dynamiques' },
  minScore: { en: 'Minimum score', fr: 'Score minimal' },
  maxSuggestions: { en: 'Maximum suggestions', fr: 'Nombre maximal de suggestions' },
  minDynamicScore: { en: 'Minimum dynamic score', fr: 'Score dynamique minimal' },
  maxDynamicTags: { en: 'Maximum dynamic tags', fr: 'Nombre maximal d’étiquettes dynamiques' },
  dynamicNgramMin: { en: 'Minimum phrase words', fr: 'Mots minimaux par expression' },
  dynamicNgramMax: { en: 'Maximum phrase words', fr: 'Mots maximaux par expression' },
  semanticWeight: { en: 'Semantic weight', fr: 'Pondération sémantique' },
  lexicalWeight: { en: 'Lexical weight', fr: 'Pondération lexicale' },
  exactAliasBoost: { en: 'Exact alias boost', fr: 'Bonus d’alias exact' },
  negationPenalty: { en: 'Negation penalty', fr: 'Pénalité de négation' },
  negationWindow: { en: 'Negation window', fr: 'Fenêtre de négation' },
  useEmbeddingCache: { en: 'Cache embeddings', fr: 'Mettre les plongements en cache' },
  useBrowserCache: { en: 'Cache model files', fr: 'Mettre les fichiers du modèle en cache' },
  scoring: { en: 'Scoring', fr: 'Notation' },
  tags: { en: 'Tags', fr: 'Étiquettes' },
  addTag: { en: 'Add tag', fr: 'Ajouter une étiquette' },
  removeTag: { en: 'Remove tag', fr: 'Supprimer l’étiquette' },
  key: { en: 'Key', fr: 'Clé' },
  labelEn: { en: 'English label', fr: 'Libellé anglais' },
  labelFr: { en: 'French label', fr: 'Libellé français' },
  descriptionEn: { en: 'English description', fr: 'Description anglaise' },
  descriptionFr: { en: 'French description', fr: 'Description française' },
  aliases: { en: 'Aliases', fr: 'Alias' },
  color: { en: 'Color', fr: 'Couleur' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const colorOptions = computed(() => AGREEMENT_TAG_COLORS.map(color => ({
  label: color,
  value: color
})))

const targetOptions = computed(() => GCS_TEXTAREA_TARGETS.map(target => ({
  key: target.key,
  value: target.key,
  label: locale.value === 'fr' ? target.label.fr : target.label.en,
  descriptionText: locale.value === 'fr' ? target.description.fr : target.description.en
})))

const currentTarget = computed<NarrativeTagsTargetConfig>(() => getNarrativeTagsTargetConfig(state.value, activeTarget.value))

const tagKeyAtIndex = (index: number, key: string): string => `${index}-${key}`

const nextAvailableKey = () => {
  const existingKeys = new Set(state.value.tags.map(tag => tag.key))
  let nextIndex = state.value.tags.length + 1
  let key = `tag-${nextIndex}`

  while (existingKeys.has(key)) {
    nextIndex += 1
    key = `tag-${nextIndex}`
  }

  return key
}

watch(() => model.value, value => {
  const nextState = normalizeNarrativeTagsConfig(value)
  if (JSON.stringify(toNarrativeTagsJson(nextState)) !== JSON.stringify(toNarrativeTagsJson(state.value))) {
    state.value = nextState
  }
}, { deep: true })

watch(state, value => {
  const nextModel = toNarrativeTagsJson(value)
  if (JSON.stringify(nextModel) !== JSON.stringify(model.value)) {
    model.value = nextModel
  }
}, { deep: true })

const createTag = (): NarrativeTagDefinition => {
  const nextIndex = state.value.tags.length + 1
  return {
    key: nextAvailableKey(),
    label: {
      en: `Tag ${nextIndex}`,
      fr: `Étiquette ${nextIndex}`
    },
    description: {
      en: '',
      fr: ''
    },
    aliases: [],
    color: 'neutral'
  }
}

const addTag = () => {
  state.value.tags = [...state.value.tags, createTag()]
}

const removeTag = (index: number) => {
  state.value.tags = state.value.tags.filter((_, itemIndex) => itemIndex !== index)
}

const updateLocalizedField = (
  tag: NarrativeTagDefinition,
  field: 'label' | 'description',
  tagLocale: NarrativeTagLocale,
  value: string | number
) => {
  tag[field][tagLocale] = String(value)
}

const updateTagKey = (tag: NarrativeTagDefinition, value: string | number) => {
  tag.key = normalizeNarrativeTagKey(String(value))
}

const updateAllowCustomTags = (value: boolean | string) => {
  currentTarget.value.allowCustomTags = value === true
}

const updateAllowDynamicTagSuggestions = (value: boolean | string) => {
  currentTarget.value.allowDynamicTagSuggestions = value === true
}

const updateUseEmbeddingCache = (value: boolean | string) => {
  currentTarget.value.useEmbeddingCache = value === true
}

const updateUseBrowserCache = (value: boolean | string) => {
  currentTarget.value.useBrowserCache = value === true
}

const updateTargetEnabled = (targetKey: GcsTextareaKnownTargetKey, value: boolean | string) => {
  state.value.targets[targetKey].enabled = value === true
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h3 class="text-base font-semibold text-zinc-900 dark:text-white">
        {{ text('title') }}
      </h3>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {{ text('description') }}
      </p>
    </div>

    <CommonSection :title="text('targetFields')" badge="01" :grid-cols="2">
      <div class="space-y-2 md:col-span-2">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {{ text('targetDescription') }}
        </p>
      </div>

      <UFormField :label="text('target')">
        <USelect
          v-model="activeTarget"
          :items="targetOptions"
          value-key="value"
          label-key="label" />
      </UFormField>

      <UFormField
        :label="text('enabled')"
        :description="targetOptions.find(target => target.key === activeTarget)?.descriptionText">
        <div class="flex min-h-10 items-center">
          <USwitch
            :model-value="currentTarget.enabled"
            @update:model-value="(value: boolean | string) => updateTargetEnabled(activeTarget, value)" />
        </div>
      </UFormField>

      <UFormField :label="text('allowCustomTags')">
        <div class="flex min-h-10 items-center">
          <USwitch
            :model-value="currentTarget.allowCustomTags"
            @update:model-value="updateAllowCustomTags" />
        </div>
      </UFormField>

      <UFormField :label="text('allowDynamicTagSuggestions')">
        <div class="flex min-h-10 items-center">
          <USwitch
            :model-value="currentTarget.allowDynamicTagSuggestions"
            @update:model-value="updateAllowDynamicTagSuggestions" />
        </div>
      </UFormField>

      <UFormField :label="text('minScore')">
        <UInput v-model.number="currentTarget.minScore" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('maxSuggestions')">
        <UInput v-model.number="currentTarget.maxSuggestions" type="number" min="1" max="12" step="1" />
      </UFormField>
    </CommonSection>

    <CommonSection :title="text('scoring')" badge="02" :grid-cols="3">
      <UFormField :label="text('minDynamicScore')">
        <UInput v-model.number="currentTarget.minDynamicScore" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('maxDynamicTags')">
        <UInput v-model.number="currentTarget.maxDynamicTags" type="number" min="1" max="12" step="1" />
      </UFormField>

      <UFormField :label="text('dynamicNgramMin')">
        <UInput v-model.number="currentTarget.dynamicNgramMin" type="number" min="1" max="5" step="1" />
      </UFormField>

      <UFormField :label="text('dynamicNgramMax')">
        <UInput v-model.number="currentTarget.dynamicNgramMax" type="number" min="1" max="5" step="1" />
      </UFormField>

      <UFormField :label="text('semanticWeight')">
        <UInput v-model.number="currentTarget.semanticWeight" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('lexicalWeight')">
        <UInput v-model.number="currentTarget.lexicalWeight" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('exactAliasBoost')">
        <UInput v-model.number="currentTarget.exactAliasBoost" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('negationPenalty')">
        <UInput v-model.number="currentTarget.negationPenalty" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('negationWindow')">
        <UInput v-model.number="currentTarget.negationWindow" type="number" min="0" max="20" step="1" />
      </UFormField>

      <UFormField :label="text('useEmbeddingCache')">
        <div class="flex min-h-10 items-center">
          <USwitch
            :model-value="currentTarget.useEmbeddingCache"
            @update:model-value="updateUseEmbeddingCache" />
        </div>
      </UFormField>

      <UFormField :label="text('useBrowserCache')">
        <div class="flex min-h-10 items-center">
          <USwitch
            :model-value="currentTarget.useBrowserCache"
            @update:model-value="updateUseBrowserCache" />
        </div>
      </UFormField>
    </CommonSection>

    <CommonSection :title="text('tags')" badge="03" :grid-cols="1">
      <div class="space-y-4">
        <div
          v-for="(tag, index) in state.tags"
          :key="tagKeyAtIndex(index, tag.key)"
          class="border-default space-y-4 border-b pb-4 last:border-b-0 last:pb-0">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <UFormField :label="text('key')">
              <UInput
                :model-value="tag.key"
                @update:model-value="(value: string | number) => updateTagKey(tag, value)" />
            </UFormField>

            <UFormField :label="text('labelEn')">
              <UInput
                :model-value="tag.label.en"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'label', 'en', value)" />
            </UFormField>

            <UFormField :label="text('labelFr')">
              <UInput
                :model-value="tag.label.fr"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'label', 'fr', value)" />
            </UFormField>

            <UFormField :label="text('descriptionEn')">
              <CommonTextarea
                :model-value="tag.description.en"
                :rows="2"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'description', 'en', value)" />
            </UFormField>

            <UFormField :label="text('descriptionFr')">
              <CommonTextarea
                :model-value="tag.description.fr"
                :rows="2"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'description', 'fr', value)" />
            </UFormField>

            <UFormField :label="text('color')">
              <USelect
                v-model="tag.color"
                :items="colorOptions"
                value-key="value"
                label-key="label" />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <UFormField :label="text('aliases')">
              <UInputTags v-model="tag.aliases" :add-on-blur="true" />
            </UFormField>

            <UTooltip :text="text('removeTag')">
              <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                class="cursor-default"
                :aria-label="text('removeTag')"
                @click="removeTag(index)" />
            </UTooltip>
          </div>
        </div>

        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="cursor-default"
          :label="text('addTag')"
          @click="addTag" />
      </div>
    </CommonSection>
  </div>
</template>
