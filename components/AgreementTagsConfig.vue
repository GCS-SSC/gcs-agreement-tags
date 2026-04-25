<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  AGREEMENT_TAG_COLORS,
  normalizeAgreementTagsConfig,
  toAgreementTagsJson
} from './agreement-tags'
import type { AgreementTagDefinition, AgreementTagsConfig, AgreementTagLocale } from './agreement-tags'

const model = defineModel<Record<string, JsonValue>>({
  default: () => ({})
})

const { locale } = useI18n()

const state: Ref<AgreementTagsConfig> = ref(normalizeAgreementTagsConfig(model.value))

const labels = {
  title: { en: 'Agreement tag setup', fr: 'Configuration des étiquettes d’entente' },
  description: {
    en: 'Configure the predefined English tag vocabulary used beside agreement descriptions.',
    fr: 'Configurez le vocabulaire prédéfini d’étiquettes anglaises utilisé avec les descriptions d’entente.'
  },
  enabled: { en: 'Enable tag suggestions', fr: 'Activer les suggestions d’étiquettes' },
  minScore: { en: 'Minimum score', fr: 'Score minimal' },
  maxSuggestions: { en: 'Maximum suggestions', fr: 'Nombre maximal de suggestions' },
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

watch(() => model.value, value => {
  state.value = normalizeAgreementTagsConfig(value)
}, { deep: true })

watch(state, value => {
  model.value = toAgreementTagsJson(value)
}, { deep: true })

const createTag = (): AgreementTagDefinition => {
  const nextIndex = state.value.tags.length + 1
  return {
    key: `tag-${nextIndex}`,
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
  tag: AgreementTagDefinition,
  field: 'label' | 'description',
  tagLocale: AgreementTagLocale,
  value: string | number
) => {
  tag[field][tagLocale] = String(value)
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

    <CommonSection :title="text('title')" badge="01" :grid-cols="3">
      <UFormField :label="text('enabled')">
        <div class="flex min-h-10 items-center">
          <USwitch v-model="state.enabled" />
        </div>
      </UFormField>

      <UFormField :label="text('minScore')">
        <UInput v-model.number="state.minScore" type="number" min="0" max="1" step="0.01" />
      </UFormField>

      <UFormField :label="text('maxSuggestions')">
        <UInput v-model.number="state.maxSuggestions" type="number" min="1" max="12" step="1" />
      </UFormField>
    </CommonSection>

    <CommonSection :title="text('tags')" badge="02" :grid-cols="1">
      <div class="space-y-4">
        <div
          v-for="(tag, index) in state.tags"
          :key="tag.key"
          class="border-default space-y-4 border-b pb-4 last:border-b-0 last:pb-0">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <UFormField :label="text('key')">
              <UInput v-model="tag.key" />
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
