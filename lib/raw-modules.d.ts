// Vite serves a `?raw` import as the file's text. Used for config/voice.md,
// which is bundled at build time because a Worker has no filesystem.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
