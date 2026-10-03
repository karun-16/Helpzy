import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerProfileScreen } from '@/components/customer-settings-screen';

export default function CustomerProfileRoute() {
  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <CustomerProfileScreen />
    </AuthenticatedRoleScreen>
  );
}
