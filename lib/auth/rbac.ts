import { queryAll } from "@/lib/db";

/**
 * Role-based access control. Permissions are coarse-grained capability strings
 * checked on the server (HTTP handlers and any privileged operation).
 */
export const PERMISSIONS = [
  "market.read",
  "news.read",
  "news.save",
  "research.read",
  "analytics.read",
  "portfolio.read",
  "portfolio.trade",
  "alerts.write",
  "workspaces.write",
  "admin.users",
  "admin.providers",
  "admin.audit",
  "bots.read",
  "bots.control",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleKey = "viewer" | "analyst" | "trader" | "admin" | "guest";

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string; permissions: Permission[] }> = {
  viewer: {
    name: "Viewer",
    description: "Read-only market, news and research access.",
    permissions: ["market.read", "news.read", "research.read"],
  },
  guest: {
    name: "Guest",
    description: "Demo read-only access: markets, news, calendar, analytics and portfolio views. No alerts, workspaces, admin or bots.",
    permissions: [
      "market.read",
      "news.read",
      "research.read",
      "analytics.read",
      "portfolio.read",
    ],
  },
  analyst: {
    name: "Analyst",
    description: "Viewer plus analytics, workspaces, alerts and screener.",
    permissions: [
      "market.read",
      "news.read",
      "news.save",
      "research.read",
      "analytics.read",
      "alerts.write",
      "workspaces.write",
    ],
  },
  trader: {
    name: "Trader",
    description: "Analyst plus portfolio and bot monitoring; trading is separate.",
    permissions: [
      "market.read",
      "news.read",
      "news.save",
      "research.read",
      "analytics.read",
      "portfolio.read",
      "alerts.write",
      "workspaces.write",
      "bots.read",
    ],
  },
  admin: {
    name: "Administrator",
    description: "Full access including users, providers, audit and bot control.",
    permissions: [...PERMISSIONS],
  },
};

/** Resolve a user's effective permission set from their assigned roles. */
export function permissionsForUser(userId: string): Permission[] {
  const rows = queryAll<{ key: string }>(
    `SELECT r.key AS key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    userId,
  );
  const set = new Set<Permission>();
  for (const row of rows) {
    const def = ROLE_DEFINITIONS[row.key as RoleKey];
    if (def) for (const p of def.permissions) set.add(p);
  }
  return [...set];
}

export function rolesForUser(userId: string): string[] {
  return queryAll<{ key: string }>(
    `SELECT r.key AS key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    userId,
  ).map((r) => r.key);
}