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
export interface FurnitureItem { readonly id: string; readonly label: string; readonly category: string; readonly dims: { w: number; d: number; h: number }; readonly material: string; readonly model: ModelPart[]; readonly signal?: { heads: string }; readonly led?: { kind: string }; readonly gltf?: string; readonly scale?: number }
export interface FurnitureCatalog { readonly categories: Record<string, string>; readonly items: FurnitureItem[] }

export interface MaterialItem { readonly id: string; readonly label: string; readonly category: string; readonly color: string; readonly pattern: string; readonly scaleM: number; readonly roughness: number; readonly permeable: boolean; readonly opacity?: number }
export interface MaterialCatalog { readonly categories: Record<string, string>; readonly items: MaterialItem[] }

export interface Catalogs { readonly signs: SignCatalog; readonly furniture: FurnitureCatalog; readonly materials: MaterialCatalog }

// ---------------------------------------------------------------- DRIP platform

export type Role = 'viewer' | 'editor' | 'publisher' | 'admin';
export interface SessionUser {
  readonly sub: string; readonly name: string; readonly username?: string; readonly email?: string; readonly role: Role;
  readonly provider: string; readonly providerLabel?: string; readonly provisional?: boolean; readonly mustChangePassword?: boolean; readonly expiresAt?: string;
}
export interface SessionInfo {
  readonly mode: 'open' | 'protected';
  readonly authenticated: boolean;
  readonly user: SessionUser | null;
  readonly localLogin: boolean;
  readonly providers: readonly { id: string; label: string; kind: string }[];
  readonly provisionalHint: string | null;
}
export interface LicenseInfo {
  readonly status: 'active' | 'trialing' | 'offline_grace' | 'expired' | 'offline_expired' | 'unlicensed' | string;
  readonly plan: string; readonly planLabel: string; readonly source: 'key' | 'drip-id' | 'trial';
  readonly validUntil?: string; readonly daysLeft?: number; readonly customer?: string; readonly seats?: number;
  readonly features: readonly string[]; readonly limits: Record<string, number | null>; readonly keyHint?: string; readonly checkedAt?: string;
  readonly error?: string | null; readonly enforcement: 'soft' | 'strict'; readonly deviceId: string; readonly catalog: Record<string, string>; readonly platformUrl: string;
}
export interface UpdateInfo {
  readonly current: string; readonly checkedAt: string | null; readonly error: string | null; readonly available: boolean; readonly channel: string; readonly autoCheck: boolean;
  readonly latest: { version: string; notes?: string; publishedAt?: string; mandatory?: boolean; size?: number } | null;
  readonly pending: { version: string } | null;
}
export interface IdentityProviderCfg {
  readonly id: string; readonly label: string; readonly kind: string; readonly issuer: string; readonly clientId: string; readonly scopes: string; readonly enabled: boolean; readonly hasClientSecret?: boolean;
}
export interface PlatformConfig {
  readonly authMode: 'open' | 'protected'; readonly sessionHours: number; readonly platformUrl: string; readonly fstUrl?: string; readonly identityProviders: readonly IdentityProviderCfg[];
  readonly roleMapping: Record<string, Role>; readonly defaultRole: Role; readonly localLogin: boolean; readonly updates: { autoCheck: boolean; channel: string };
  readonly licenseEnforcement: 'soft' | 'strict';
}
export interface ApiKeyInfo { readonly id: string; readonly name: string; readonly role: Role; readonly prefix: string; readonly createdAt: string; readonly createdBy: string; readonly lastUsedAt: string | null; readonly key?: string }
export interface WebhookInfo { readonly id: string; readonly url: string; readonly label: string; readonly events: string[]; readonly active: boolean; readonly secret?: string; readonly lastDelivery?: { ok: boolean; status: number | null; at: string; event: string; error?: string } }
export interface LocalUser { readonly username: string; readonly name: string; readonly role: Role; readonly provisional?: boolean; readonly mustChangePassword?: boolean; readonly disabled?: boolean; readonly expiresAt?: string; readonly lastLoginAt?: string }
