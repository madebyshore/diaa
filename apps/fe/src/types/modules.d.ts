declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.scss" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.wgsl" {
  const source: string;
  export default source;
}
