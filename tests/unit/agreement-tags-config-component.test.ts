// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import AgreementTagsConfig from '../../components/AgreementTagsConfig.vue'

describe('AgreementTagsConfig', () => {
  it('uses InputTags for predefined tag aliases', () => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))

    const wrapper = mount(AgreementTagsConfig, {
      props: {
        modelValue: {}
      },
      global: {
        stubs: {
          CommonSection: defineComponent({
            setup: (_, { slots }) => () => h('section', slots.default?.())
          }),
          UFormField: defineComponent({
            setup: (_, { slots }) => () => h('label', slots.default?.())
          }),
          UInput: true,
          CommonTextarea: true,
          USwitch: true,
          USelect: true,
          UTooltip: true,
          UButton: true,
          UInputTags: defineComponent({
            props: ['modelValue'],
            setup: props => () => h('div', {
              'data-input-tags': JSON.stringify(props.modelValue ?? [])
            })
          })
        }
      }
    })

    expect(wrapper.find('[data-input-tags]').exists()).toBe(true)
    vi.unstubAllGlobals()
  })
})
