declare module "mustache" {
  export function render(
    template: string,
    view: unknown,
    partials?: Record<string, string>
  ): string;
}
