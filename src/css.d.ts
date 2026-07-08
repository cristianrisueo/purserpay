// Ambient declaration for global CSS side-effect imports (e.g. globals.css).
// The Vite build provided this via the "vite/client" types; under Next.js we
// declare it directly so `tsc --noEmit` resolves `import "@/styles/globals.css"`.
declare module "*.css"
