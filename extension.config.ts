import { defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-agreement-tags',
  name: {
    en: 'Agreement Tags',
    fr: 'Étiquettes d’entente'
  },
  description: {
    en: 'Suggests predefined tags from English agreement descriptions.',
    fr: 'Suggère des étiquettes prédéfinies à partir des descriptions anglaises d’entente.'
  },
  admin: {
    streamConfig: {
      path: './components/AgreementTagsConfig.vue'
    }
  },
  client: {
    slots: [
      {
        slot: 'textarea.after',
        path: './components/AgreementTagsSlot.vue'
      }
    ]
  },
  assets: [
    {
      path: './client',
      baseURL: '/extensions/gcs-agreement-tags/client'
    },
    {
      path: './models',
      baseURL: '/extensions/gcs-agreement-tags/models'
    },
    {
      package: 'onnxruntime-web',
      packagePath: 'dist',
      baseURL: '/extensions/gcs-agreement-tags/ort'
    }
  ],
  serverHandlers: [
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'get',
      path: './server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.get.ts'
    },
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'patch',
      path: './server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.patch.ts'
    }
  ]
})
