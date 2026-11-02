export const CITEWRITER_CORE_VERSION = '0.1.0';

export interface CoreSanityCheck {
  status: 'ok';
  initializedAt: string;
}

export function getCoreStatus(): CoreSanityCheck {
  return {
    status: 'ok',
    initializedAt: new Date().toISOString(),
  };
}
