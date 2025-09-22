declare module "viteburner" {
  export interface ViteburnerConfig {
    watch?: Array<{
      pattern: string
      transform?: boolean
    }>
    sourcemap?: string
  }

  export interface Config {
    resolve?: {
      alias?: Record<string, string>
    }
    build?: {
      outDir?: string
      emptyOutDir?: boolean
      minify?: boolean
    }
    viteburner?: ViteburnerConfig
  }

  export function defineConfig(config: Config): Config
}
