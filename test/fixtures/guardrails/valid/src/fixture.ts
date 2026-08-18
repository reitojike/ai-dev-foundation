declare const input: unknown;
const labels = ['safe', 'typed'] as const;
export const config = { enabled: true } satisfies { enabled: boolean };

export const value = typeof input === 'string' ? `${input}-${labels[0]}` : '';
