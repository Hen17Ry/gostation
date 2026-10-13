declare module 'osrm-text-instructions' {
  export interface OsrmStep {
    maneuver: { type: string; modifier?: string; exit?: number; bearing_after?: number }
    name?: string
    ref?: string
    mode?: string
    distance?: number
    rotary_name?: string
    destinations?: string
    exits?: string
  }
  export interface CompileOptions {
    legCount?: number
    legIndex?: number
    waypointName?: string
  }
  interface Compiler {
    compile(language: string, step: OsrmStep, options?: CompileOptions): string
  }
  export default function osrmTextInstructions(version: 'v5'): Compiler
}
