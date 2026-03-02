const AVATAR_COLORS = [
  '#7aa2f7', '#bb9af7', '#9ece6a', '#ff9e64', '#f7768e',
  '#2ac3de', '#e0af68', '#7dcfff', '#73daca', '#b4f9f8',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/[\s\-_]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
