import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerHomeScreen } from '@/components/customer-home-screen';

export default function CustomerRoute() {
  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <CustomerHomeScreen />
    </AuthenticatedRoleScreen>
  );
}
