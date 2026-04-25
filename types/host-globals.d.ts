declare const useToast: () => {
  add: (input: { title: string; description?: string; color?: string }) => void
}

declare const $fetch: <T = unknown>(
  url: string,
  options?: {
    method?: string
    body?: unknown
  }
) => Promise<T>
