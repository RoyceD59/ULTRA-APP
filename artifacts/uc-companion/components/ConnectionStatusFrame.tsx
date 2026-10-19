import React, { type PropsWithChildren } from 'react';

/** Web remains a pass-through: no native imports, subscription or extra layout. */
export default function ConnectionStatusFrame({ children }: PropsWithChildren) {
  return <>{children}</>;
}