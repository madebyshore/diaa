interface SanityClientConfig {
  projectId?: string;
  dataset?: string;
}

interface SanityClientLike {
  config?: () => SanityClientConfig;
  projectId?: string;
  dataset?: string;
}

interface ImageUrlOptions {
  width?: number;
  height?: number;
  fit?: string;
  quality?: number;
  format?: string;
}

interface SanityAsset {
  url?: string;
  _ref?: string;
}

interface SanityImageSource {
  url?: string;
  asset?: SanityAsset;
  _ref?: string;
  _id?: string;
}

function getProjectDetails(
  clientOrConfig: SanityClientLike | null
): { projectId: string | undefined; dataset: string | undefined } {
  if (!clientOrConfig) return { projectId: undefined, dataset: undefined };
  if (typeof clientOrConfig.config === "function") {
    const cfg = clientOrConfig.config();
    return { projectId: cfg.projectId, dataset: cfg.dataset };
  }
  return {
    projectId: clientOrConfig.projectId,
    dataset: clientOrConfig.dataset,
  };
}

function buildBaseFromRef(
  projectId: string | undefined,
  dataset: string | undefined,
  ref: string
): string | null {
  if (!projectId || !dataset || !ref) return null;
  const parts = String(ref).split("-");
  if (parts.length < 4) return null;
  const id = parts[1];
  const dims = parts[2];
  const ext = parts[3];
  return `https://cdn.sanity.io/images/${projectId}/${dataset}/${id}-${dims}.${ext}`;
}

export function createUrlFor(
  clientOrConfig: SanityClientLike
): (source: SanityImageSource | null, opts?: ImageUrlOptions) => string | null {
  const { projectId, dataset } = getProjectDetails(clientOrConfig);
  return function urlFor(
    source: SanityImageSource | null,
    opts: ImageUrlOptions = {}
  ): string | null {
    if (!source) return null;
    let base: string | null = null;

    if (source.url) {
      base = source.url;
    } else if (source.asset && (source.asset.url || source.asset._ref)) {
      base =
        source.asset.url ||
        buildBaseFromRef(projectId, dataset, source.asset._ref!);
    } else if (source._ref || source._id) {
      base = buildBaseFromRef(projectId, dataset, source._ref || source._id!);
    }
    if (!base) return null;

    const params = new URLSearchParams();
    if (opts.width) params.set("w", String(opts.width));
    if (opts.height) params.set("h", String(opts.height));
    if (opts.fit) params.set("fit", String(opts.fit));
    if (typeof opts.quality === "number") params.set("q", String(opts.quality));
    if (opts.format) params.set("fm", String(opts.format));

    return params.toString() ? `${base}?${params}` : base;
  };
}
