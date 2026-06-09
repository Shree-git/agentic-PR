if (!session?.user?.id) {
  redirect('/login?next=/checkout');
}
const userId = session.user.id;