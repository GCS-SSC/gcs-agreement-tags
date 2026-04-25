import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@gcs-ssc/extensions': new URL('../../packages/gcs-ssc-extensions/src/index.ts', import.meta.url).pathname,
      '@gcs-ssc/extensions/server': new URL('../../packages/gcs-ssc-extensions/src/server.ts', import.meta.url).pathname,
      '@gcs-ssc/extensions/nuxt': new URL('../../packages/gcs-ssc-extensions/src/nuxt.ts', import.meta.url).pathname
    }
  }
})
