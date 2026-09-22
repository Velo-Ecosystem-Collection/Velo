export function projectDestination(
  projectId: string | null | undefined,
  suffix: string,
): string | null {
  if (!projectId) return null;
  return `/projects/${projectId}${suffix}`;
}

export function isSidebarPathActive(currentPath: string | undefined, url: string): boolean {
  if (!currentPath) return false;
  if (url === "/dashboard") return currentPath === url;
  return currentPath === url || currentPath.startsWith(`${url}/`);
}
