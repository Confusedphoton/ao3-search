import type { PermeabilityFilters, CategoryPermeabilityFilter } from '../config/settings';
import type { GraphNode, WorkMetadata } from '../graph/types';
import { NodeKind } from '../graph/types';
import { PERMEABILITY_CATEGORY_KEYS } from '../config/ao3Meta';

function isBlocked(
  workValues: string[],
  filter: CategoryPermeabilityFilter,
): boolean {
  if (filter.values.length === 0) return false;

  const selected = new Set(filter.values);

  if (filter.mode === 'blacklist') {
    return workValues.some((value) => selected.has(value));
  }

  // Whitelist: allow only if every work value is in the selected set.
  return workValues.some((value) => !selected.has(value));
}

function singleValuePermeability(
  value: string | null | undefined,
  filter: CategoryPermeabilityFilter,
): number {
  if (value == null || value === '') return 1;
  return isBlocked([value], filter) ? filter.permeability : 1;
}

function multiValuePermeability(
  values: string[] | undefined,
  filter: CategoryPermeabilityFilter,
): number {
  if (!values || values.length === 0) return 1;
  return isBlocked(values, filter) ? filter.permeability : 1;
}

/** Permeability for one metadata category given work meta and user filter. */
export function categoryPermeability(
  meta: WorkMetadata | undefined,
  category: keyof PermeabilityFilters,
  filter: CategoryPermeabilityFilter,
): number {
  if (!meta) return 1;
  if (filter.values.length === 0) return 1;

  switch (category) {
    case 'language':
      return singleValuePermeability(meta.language, filter);
    case 'rating':
      return singleValuePermeability(meta.rating, filter);
    case 'completionStatus':
      return singleValuePermeability(meta.completionStatus, filter);
    case 'archiveWarnings':
      return multiValuePermeability(meta.archiveWarnings, filter);
    case 'fandoms':
      return multiValuePermeability(meta.fandoms, filter);
    case 'categories':
      return multiValuePermeability(meta.categories, filter);
    default:
      return 1;
  }
}

/** Total work permeability μ = ∏ category permeabilities. */
export function workPermeability(
  meta: WorkMetadata | undefined,
  filters: PermeabilityFilters,
): number {
  let mu = 1;
  for (const key of PERMEABILITY_CATEGORY_KEYS) {
    mu *= categoryPermeability(meta, key, filters[key]);
  }
  return mu;
}

/** Per-node μ array: works from meta, non-works and missing meta → 1. */
export function buildNodePermeabilities(
  nodeByIndex: Array<Pick<GraphNode, 'kind' | 'meta'>>,
  filters: PermeabilityFilters,
): Float64Array {
  const out = new Float64Array(nodeByIndex.length);
  for (let i = 0; i < nodeByIndex.length; i++) {
    const node = nodeByIndex[i];
    out[i] =
      node.kind === NodeKind.Work ? workPermeability(node.meta, filters) : 1;
  }
  return out;
}

/** Element-wise φ(μᵢ, μⱼ) = μᵢ · μⱼ applied to transition weights. */
export function applyPermeabilityFilter(
  offsets: number[],
  neighbors: number[],
  transition: number[],
  nodePermeabilities: Float64Array | number[],
): void {
  const nodeCount = offsets.length - 1;
  for (let u = 0; u < nodeCount; u++) {
    const muU = nodePermeabilities[u] ?? 1;
    const start = offsets[u];
    const end = offsets[u + 1];
    for (let edge = start; edge < end; edge++) {
      const v = neighbors[edge];
      const muV = nodePermeabilities[v] ?? 1;
      transition[edge] *= muU * muV;
    }
  }
}
