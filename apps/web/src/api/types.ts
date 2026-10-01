import type { ProjectMeta, Scenario } from '@drip-urban/core';

export interface ProjectSummary extends ProjectMeta {
  readonly scenarioCount: number;
  readonly hasThumbnail: boolean;
  readonly opCount: number;
  readonly source?: string;
  readonly description?: string;
}

export interface ScenarioSummary extends Omit<Scenario, 'operations'> {
  readonly opCount: number;
  readonly revision: number;
  readonly updatedAt?: string;
}

export interface StoredScenario extends Scenario {
  readonly revision: number;
  readonly updatedAt?: string;
}

export interface ProjectDetail extends ProjectMeta {
  readonly scenarios: ScenarioSummary[];
  readonly source?: string;
}

export interface Template {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly description: string;
  readonly baseline: 'seed' | 'osm' | 'empty';
}

export interface Job {
  readonly id: string;
  readonly status: 'running' | 'done' | 'error';
  readonly progress: number;
  readonly message: string;
  readonly error?: string;
  readonly result?: ProjectSummary;
}

export interface ProviderStatus {
  readonly id: string;
  readonly label: string;
  readonly use: string;
  readonly kind: 'key' | 'token' | 'url';
  readonly configured: boolean;
  readonly hint: string;
  readonly lastTest?: { ok: boolean; message: string; at: string } | null;
}

export interface Snapshot { readonly id: string; readonly label: string; readonly author: string; readonly at: string; readonly automatic: boolean }
export interface AuditEntry { readonly id: string; readonly at: string; readonly author: string; readonly action: string; readonly details: Record<string, unknown> }
export interface UserInfo { readonly name: string; readonly role: 'viewer' | 'editor' | 'publisher' | 'admin'; readonly canPublish: boolean }

export interface SignItem { readonly id: string; readonly file: string; readonly label: string; readonly family: string }
export interface SignCatalog { readonly source: string; readonly license: string; readonly licenseUrl: string; readonly families: Record<string, string>; readonly items: SignItem[] }

export interface ModelPart { readonly shape: 'box' | 'cylinder' | 'sphere' | 'cone'; readonly size?: [number, number, number]; readonly r?: number; readonly h?: number; readonly at: [number, number, number]; readonly mat: string }
export interface FurnitureItem { readonly id: string; readonly label: string; readonly category: string; readonly dims: { w: number; d: number; h: number }; readonly material: string; readonly model: ModelPart[]; readonly signal?: { heads: string } }
export interface FurnitureCatalog { readonly categories: Record<string, string>; readonly items: FurnitureItem[] }

export interface MaterialItem { readonly id: string; readonly label: string; readonly category: string; readonly color: string; readonly pattern: string; readonly scaleM: number; readonly roughness: number; readonly permeable: boolean; readonly opacity?: number }
export interface MaterialCatalog { readonly categories: Record<string, string>; readonly items: MaterialItem[] }

export interface Catalogs { readonly signs: SignCatalog; readonly furniture: FurnitureCatalog; readonly materials: MaterialCatalog }
