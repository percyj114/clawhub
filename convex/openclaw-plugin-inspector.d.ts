declare module "@openclaw/plugin-inspector" {
  export const pluginRoot: {
    runCheck(options?: {
      pluginRoot?: string;
      openclawPath?: string | false;
      outDir?: string;
      capture?: boolean;
      mockSdk?: boolean;
      allowExecution?: boolean;
      generatedAt?: string;
    }): Promise<{ report: unknown; paths?: unknown }>;
  };
}
