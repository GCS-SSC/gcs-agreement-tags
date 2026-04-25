// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import AgreementTagsSlot from '../../components/AgreementTagsSlot.vue'

const mountSlot = () => mount(AgreementTagsSlot, {
  props: {
    config: {
      enabled: true,
      minScore: 0.1,
      maxSuggestions: 2,
      tags: [{
        key: 'infrastructure',
        label: { en: 'Infrastructure', fr: 'Infrastructure' },
        description: { en: 'Facilities and equipment', fr: 'Installations et équipement' },
        aliases: ['capital project'],
        color: 'neutral'
      }]
    },
    context: {
      textarea: {
        kind: 'agreement.description',
        locale: 'en',
        text: 'Funds equipment for a facility.',
        streamId: 'stream/31',
        agreementId: 'agreement 44'
      }
    }
  },
  global: {
    stubs: {
      UBadge: defineComponent({
        setup: (_, { slots }) => () => h('span', slots.default?.())
      }),
      UButton: defineComponent({
        props: ['label'],
        setup: props => () => h('button', String(props.label ?? ''))
      }),
      USelectMenu: true,
      CommonSaveButton: true
    }
  }
})

describe('AgreementTagsSlot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete (globalThis as typeof globalThis & { __gcsAgreementTagsWorkerState?: unknown }).__gcsAgreementTagsWorkerState
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('encodes route identifiers before loading persisted tags', async () => {
    const fetchMock = vi.fn(async () => ({ tags: ['infrastructure'] }))
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/gcs-agreement-tags/streams/stream%2F31/agreements/agreement%2044/tags')
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
