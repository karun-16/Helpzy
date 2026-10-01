import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerSettingsScreen } from '@/components/customer-settings-screen';

export default function CustomerSettingsRoute() {
  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <CustomerSettingsScreen />
    </AuthenticatedRoleScreen>
  );
}
