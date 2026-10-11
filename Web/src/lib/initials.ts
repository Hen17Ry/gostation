export function initials(p: { firstName: string; lastName: string }) {
  return `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase()
}
