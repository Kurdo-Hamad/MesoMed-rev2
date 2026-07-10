export function createURL(path: string): string {
  return `mesomed://${path}`;
}
export function addEventListener(): { remove: () => void } {
  return { remove: () => undefined };
}
export function getInitialURL(): Promise<string | null> {
  return Promise.resolve(null);
}
