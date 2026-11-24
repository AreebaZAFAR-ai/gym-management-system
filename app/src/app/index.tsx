import { Redirect } from 'expo-router';
import { homeFor } from '../lib/routes';
import { useSession } from '../lib/session';

export default function Index() {
  const { state } = useSession();
  if (state.status !== 'signedIn') return <Redirect href="/login" />;
  return <Redirect href={homeFor(state.user.role)} />;
}
