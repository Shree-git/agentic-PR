'use server';

import { redirect } from 'next/navigation';

// ---------------------------------------------------------------------------
// Catalog fix: guard against null/undefined session before reading user.id
// ---------------------------------------------------------------------------
export async function checkoutAction(session: unknown /* normally inferred from auth helper */) {
  // Guard: redirect unauthenticated users to login before accessing user id
  if (!(session as any)?.user?.id) {
    redirect('/login?next=/checkout');
  }

  const userId: string = (session as any).user.id;

  // TODO: actual checkout logic would follow here
  console.log('Proceeding with checkout for user', userId);

  return { success: true, userId };
}
