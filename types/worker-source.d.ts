declare module '../client/worker-source' {
  export const toTagDefinition: (tag: unknown) => unknown
  export const suggestTags: (payload: unknown) => Promise<unknown>
}

declare module '../../client/worker-source' {
  export const toTagDefinition: (tag: unknown) => unknown
  export const suggestTags: (payload: unknown) => Promise<unknown>
}
