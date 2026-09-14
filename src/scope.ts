export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function isCloakPath(path: string): boolean {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  if (
    lower === ".obsidian" ||
    lower.startsWith(".obsidian/") ||
    lower === ".trash" ||
    lower.startsWith(".trash/") ||
    lower === ".git" ||
    lower.startsWith(".git/")
  ) {
    return false;
  }
  return lower.endsWith(".md");
}
