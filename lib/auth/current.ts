import { getSessionFromCookies } from "./session";
import { permissionsForUser, rolesForUser, type Permission } from "./rbac";
import { queryOne } from "@/lib/db";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: Permission[];
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
}

export function getCurrentUser(): CurrentUser | null {
  const session = getSessionFromCookies();
  if (!session) return null;
  const user = queryOne<UserRow>(
    "SELECT id, email, display_name, status FROM users WHERE id = ?",
    session.userId,
  );
  if (!user || user.status !== "active") return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    roles: rolesForUser(user.id),
    permissions: permissionsForUser(user.id),
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireUser(): CurrentUser {
  const user = getCurrentUser();
  if (!user) throw new HttpError(401, "AUTH_REQUIRED", "Authentication required.");
  return user;
}

export function requirePermission(permission: Permission): CurrentUser {
  const user = requireUser();
  if (!user.permissions.includes(permission)) {
    throw new HttpError(403, "FORBIDDEN", `Missing permission: ${permission}`);
  }
  return user;
}

export function hasPermission(user: CurrentUser | null, permission: Permission): boolean {
  return !!user?.permissions.includes(permission);
}