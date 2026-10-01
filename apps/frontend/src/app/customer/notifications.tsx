import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerNotificationsScreen } from '@/components/customer-notifications-screen';

export default function CustomerNotificationsRoute() {
  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <CustomerNotificationsScreen />
    </AuthenticatedRoleScreen>
  );
}
