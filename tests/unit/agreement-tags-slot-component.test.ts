// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import AgreementTagsSlot from '../../components/AgreementTagsSlot.vue'

const setExtensionPayloadMock = vi.fn()

const inputTagsStub = defineComponent({
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup: (props, { emit, slots }) => () => h('div', { 'data-control': 'input-tags' }, [
    ...((props.modelValue as string[] | undefined) ?? []).map(item => h('span', { 'data-input-tag': item }, slots['item-text']?.({ item }) ?? item)),
    h('input', {
      placeholder: props.placeholder as string,
      value: (props.modelValue as string[] | undefined)?.join(',') ?? '',
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value.split(','))
    })
  ])
})

const mountSlot = (custom = false) => mount(AgreementTagsSlot, {
  props: {
    config: {
      enabled: true,
      allowCustomTags: custom,
      minScore: 0.1,
      maxSuggestions: 2,
      tags: [{
        key: custom ? 'capacity-building' : 'infrastructure',
        label: custom
          ? { en: 'Capacity building', fr: 'Renforcement des capacités' }
          : { en: 'Infrastructure', fr: 'Infrastructure' },
        description: custom
          ? { en: 'Training and skills', fr: 'Formation et compétences' }
          : { en: 'Facilities and equipment', fr: 'Installations et équipement' },
        aliases: custom ? ['training'] : ['capital project'],
        color: custom ? 'info' : 'neutral'
      }]
    },
    context: {
      kind: 'agreement.descriptions',
      descriptions: {
        en: custom ? 'Training for staff.' : 'Funds equipment for a facility.',
        fr: custom ? '' : 'Financer de l’équipement pour une installation.'
      },
      streamId: 'stream/31',
      agreementId: 'agreement 44',
      setExtensionPayload: setExtensionPayloadMock
    }
  },
  global: {
    stubs: {
      UBadge: defineComponent({
        setup: (_, { slots }) => () => h('span', slots.default?.())
      }),
      UButton: defineComponent({
        props: ['label'],
        emits: ['click'],
        setup: (props, { emit }) => () => h('button', {
          onClick: () => emit('click')
        }, String(props.label ?? ''))
      }),
      USelectMenu: defineComponent({
        props: ['items', 'placeholder'],
        setup: props => () => h('div', {
          'data-control': 'select-menu',
          'data-placeholder': props.placeholder as string,
          'data-items': JSON.stringify(props.items ?? [])
        })
      }),
      UInputTags: inputTagsStub
    }
  }
})

describe('AgreementTagsSlot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setExtensionPayloadMock.mockClear()
    delete (globalThis as typeof globalThis & { __gcsAgreementTagsWorkerState?: unknown }).__gcsAgreementTagsWorkerState
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('encodes route identifiers before loading persisted tags', async () => {
    const fetchMock = vi.fn(async () => ({ tags: [{ predefined: true, key: 'infrastructure', label: 'Infrastructure' }] }))
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/gcs-agreement-tags/streams/stream%2F31/agreements/agreement%2044/tags')
  })

  it('renders the controlled predefined dropdown without a separate save button', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ tags: [] })))
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(wrapper.find('[data-control="select-menu"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Save tags')
  })

  it('uses animated loading dots without duplicating the suggested tags label', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ tags: [] })))
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text().match(/Suggested tags/g)).toHaveLength(1)
  })

  it('renders input tags for custom mode and writes typed custom tags to the agreement payload', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ tags: [] })))
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot(true)
    await vi.runOnlyPendingTimersAsync()
    await wrapper.find('[data-control="input-tags"] input').setValue('Local priority')

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-agreement-tags', 'agreementDescriptionTags', [
      { predefined: false, label: 'Local priority' }
    ])
  })

  it('adds suggestion clicks as predefined typed tags in the agreement payload', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ tags: [] })))
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn(() => {
        const state = (globalThis as typeof globalThis & {
          __gcsAgreementTagsWorkerState: {
            requestId: number
            listeners: Set<(message: unknown) => void>
          }
        }).__gcsAgreementTagsWorkerState
        for (const listener of state.listeners) {
          listener({
            kind: 'result',
            requestId: state.requestId - 1,
            suggestions: [{ key: 'capacity-building', score: 0.9 }]
          })
        }
      })
    })

    const wrapper = mountSlot(true)
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-agreement-tags', 'agreementDescriptionTags', [
      { predefined: true, key: 'capacity-building', label: 'Capacity building' }
    ])
    expect(wrapper.find('[data-control="input-tags"]').text()).toContain('Capacity building')
    expect(wrapper.find('.agreement-tag-input__predefined').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('falls back to keyword ranking when the browser cannot create the worker', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ tags: [] })))
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error('worker blocked')
      }
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Tag suggestions unavailable')
    expect(wrapper.find('button').exists()).toBe(true)
  })
})
